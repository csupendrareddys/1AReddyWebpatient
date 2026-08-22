"""
SendClean Email Service — registry-driven.

Replaces the AWS SES integration. Templates (HTML + subject) live in the
``notification_templates`` table under ``channel='email'`` and are looked
up by ``purpose``. The body and subject are rendered with Python
``str.format`` against caller-supplied variables (``first_name``,
``otp``, ``company_name`` are auto-filled when available); the rendered
result goes to SendClean's ``/messages/sendMail`` endpoint.

Why we render server-side instead of using SendClean's ``sendTemplate``:
* the ``notification_templates`` table is the single source of truth — we
  don't want to keep template copies in sync between our DB and SendClean's
  template manager;
* tenant ``{company_name}`` interpolation is trivial here, awkward through
  SendClean's ``dynamic_value``;
* swapping providers later (Postmark / Resend / etc.) becomes a one-file
  edit instead of a template migration.

Caching mirrors :class:`SMSService` — Redis under
``email_template:<purpose>`` for 5 minutes; admin endpoints that edit
rows should call :meth:`EmailService.invalidate_template_cache`.
"""
import json
import logging

import requests
from flask import current_app

logger = logging.getLogger(__name__)


class EmailService:
    """SendClean email delivery + registry-driven templates."""

    TEMPLATE_CACHE_PREFIX = "email_template:"
    TEMPLATE_CACHE_TTL = 300  # 5 minutes

    # Fallback chain — when the operator hasn't configured a template
    # row for the requested ``purpose`` yet, we land on a sibling row
    # that's already wired in production. Two groups:
    #
    #   * OTP-style emails (verify_email_otp / reset_pw_otp) — fall back
    #     to ``verify_email_otp`` since its body is generic OTP wording.
    #   * Welcome / lifecycle emails — fall back to the patient welcome
    #     since that's the most-tested template. ``_WELCOME_PURPOSE_BY_ROLE``
    #     already does role-level routing; this catches the long tail
    #     (clinic admin, hospital admin, etc.).
    #
    # Each fallback logs a WARNING so the operator sees which template
    # is still missing in CloudWatch.
    _PURPOSE_FALLBACKS = {
        # OTPs
        'reset_pw_otp':       'verify_email_otp',
        'login_otp':          'verify_email_otp',
        'verify_phone_otp':   'verify_email_otp',
        # Welcomes / lifecycle
        'signup_welcome_clinic_admin':   'signup_welcome_patient',
        'signup_welcome_hospital_admin': 'signup_welcome_patient',
        'signup_welcome_diagnosis':      'signup_welcome_patient',
        'signup_welcome_pharmacy':       'signup_welcome_patient',
        'signup_welcome_sub_admin':      'signup_welcome_patient',
        'signup_welcome_pending':        'signup_welcome_patient',
        # Doctor invite / activation flows added in Round 8
        'doctor_invite':       'signup_welcome_patient',
        'staff_invited':       'signup_welcome_patient',
        'activation_email':    'signup_welcome_patient',
        # Notifications — fall back to the password-reset body so the
        # subject still reads like a security notice instead of 500ing.
        'login_alert':         'reset_pw_email',
        'account_locked':      'reset_pw_email',
        'password_changed':    'reset_pw_email',
        'doctor_approved':     'signup_welcome_patient',
        'doctor_rejected':     'signup_welcome_patient',
        'tenant_ready':        'signup_welcome_patient',
    }

    @staticmethod
    def _get_redis_client():
        from app.extensions import redis_client
        return redis_client

    # ── Template registry lookup ─────────────────────────────────

    @classmethod
    def _tenant_email_config(cls):
        """The current tenant's email config IF their plan grants
        ``communication.custom_email``. ``None`` → the vendor rail applies.

        Deliberately does NOT require ``own_sender_ready``: customising the
        WORDING and changing the FROM ADDRESS are independent. A tenant may
        rewrite their templates while their domain is still being verified,
        and those mails simply go out from the vendor address until it is.
        Never raises — mail must keep flowing on the vendor rail when
        anything here misbehaves.
        """
        try:
            from app.common.tenant_context import current_tenant_id
            from app.models import TenantEmailConfig
            tenant_id = current_tenant_id()
            if not tenant_id:
                return None
            config = TenantEmailConfig.for_tenant(tenant_id)
            if config is None or not config.is_active:
                return None
            from app.api.pricing.service import FeatureGate
            if not FeatureGate.is_enabled(tenant_id, 'communication.custom_email'):
                return None
            return config
        except Exception as e:  # noqa: BLE001
            logger.debug(f"[EMAIL] tenant email config lookup failed: {e}")
            return None

    @staticmethod
    def _load_tenant_template(config, purpose):
        """The tenant's own subject/body for ``purpose``, or None.

        Not Redis-cached, for the same reason as the SMS twin: it is one
        JSONB field on a row already loaded, and keeping tenant payloads out
        of the shared cache keeps the vendor-rail cache keys tenant-agnostic
        (otherwise one tenant's wording could be served to another).
        """
        entry = (config.templates or {}).get(purpose) or {}
        if not entry.get('subject') or not entry.get('body_template'):
            return None
        return {
            'subject': entry['subject'],
            'body_template': entry['body_template'],
            'variable_names': entry.get('variable_names') or [],
            'channel': 'email',
            'rail': 'tenant',
        }

    @classmethod
    def _load_template(cls, purpose):
        """Return the active ``NotificationTemplate`` row for ``purpose``.

        Resolution order:
          1. the tenant's OWN template for this purpose (plan-gated);
          2. the common (vendor) registry row, cached in Redis;
          3. the purpose's fallback row from ``_PURPOSE_FALLBACKS``.

        Unlike SMS there is no legal barrier to mixing rails — an email body
        is not bound to a registered principal entity — so a tenant that has
        customised only some purposes quietly uses vendor wording for the
        rest. That is a normal state, not a misconfiguration, so it logs at
        DEBUG rather than the WARNING its SMS counterpart uses.

        Returns ``None`` only when neither the requested purpose nor its
        fallback resolves.
        """
        config = cls._tenant_email_config()
        if config is not None:
            payload = cls._load_tenant_template(config, purpose)
            if payload:
                return payload
            logger.debug(
                "[EMAIL:TEMPLATE] tenant %s has no '%s' override — using the "
                "vendor template for this send.", config.tenant_id, purpose,
            )

        payload = cls._load_template_for_purpose(purpose)
        if payload:
            return payload

        fallback = cls._PURPOSE_FALLBACKS.get(purpose)
        if not fallback or fallback == purpose:
            return None

        payload = cls._load_template_for_purpose(fallback)
        if payload:
            logger.warning(
                "[EMAIL:TEMPLATE] purpose '%s' not configured — falling back to "
                "'%s'. Seed the dedicated row to silence this warning.",
                purpose, fallback,
            )
            return payload
        return None

    @classmethod
    def _load_template_for_purpose(cls, purpose):
        """Cache + DB lookup for one exact purpose. Returns None when
        the row is missing or inactive."""
        redis = cls._get_redis_client()
        cache_key = f"{cls.TEMPLATE_CACHE_PREFIX}{purpose}"

        cached = redis.get(cache_key) if redis else None
        if cached:
            if isinstance(cached, bytes):
                cached = cached.decode('utf-8')
            try:
                return json.loads(cached)
            except (TypeError, ValueError):
                logger.warning(f"[EMAIL:TEMPLATE] corrupt cache for {purpose}, refreshing")

        from app.models import NotificationTemplate
        row = NotificationTemplate.query.filter_by(
            purpose=purpose, channel='email', is_active=True,
        ).first()
        if not row:
            return None

        payload = {
            'subject': row.subject or '',
            'body_template': row.body_template,
            'sender_id': row.sender_id,
            'variable_names': row.variable_names or [],
        }
        if redis:
            try:
                redis.setex(cache_key, cls.TEMPLATE_CACHE_TTL, json.dumps(payload))
            except Exception as e:
                logger.debug(f"[EMAIL:TEMPLATE] cache write failed: {e}")
        return payload

    @classmethod
    def invalidate_template_cache(cls, purpose=None):
        redis = cls._get_redis_client()
        if not redis:
            return
        if purpose:
            redis.delete(f"{cls.TEMPLATE_CACHE_PREFIX}{purpose}")
            return
        cursor = 0
        while True:
            cursor, keys = redis.scan(
                cursor=cursor, match=f"{cls.TEMPLATE_CACHE_PREFIX}*", count=100
            )
            if keys:
                redis.delete(*keys)
            if cursor == 0:
                break

    # ── Helpers ──────────────────────────────────────────────────

    @staticmethod
    def _resolve_company_name():
        """Tenant display name for ``{company_name}``; falls back to brand.

        Special case: the *vendor* tenant (``is_platform=True``) is an
        internal scoping object — its name leaks into user-facing email
        as "Welcome to platform!". For vendor-context email (signup
        before any tenant is chosen, platform-owner flows, etc.) we
        substitute the configured brand name instead. Customer tenants
        — including whichever one is the anonymous fallback — always
        send under their own name.
        """
        try:
            from app.common.tenant_context import current_tenant_id
            from app.models import Tenant
            tid = current_tenant_id()
            if tid:
                t = Tenant.query.get(tid)
                if t and t.name:
                    # Vendor tenant is internal — never surface its row
                    # name or slug to end users. Use the brand instead.
                    if getattr(t, 'is_platform', False):
                        return current_app.config.get('SENDCLEAN_FROM_NAME', 'LARAZEN')
                    return t.name
        except Exception as e:
            logger.debug(f"[EMAIL] tenant lookup failed: {e}")
        return current_app.config.get('SENDCLEAN_FROM_NAME', 'LARAZEN')

    @staticmethod
    def _strip_html(html):
        """Cheap HTML→text fallback so SendClean has a text/plain part too."""
        import re
        text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.S | re.I)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'\s+', ' ', text)
        return text.strip()

    # ── Send ─────────────────────────────────────────────────────

    @classmethod
    def send_email(cls, to_email, purpose, recipient_name=None, **variables):
        """Render the ``purpose`` template and POST to SendClean's sendMail.

        :param to_email: recipient address
        :param purpose:  matches ``notification_templates.purpose`` (with ``channel='email'``)
        :param recipient_name: optional display name for the ``to`` header
        :param variables: keyword args interpolated into subject + body
        :raises ValueError: if SendClean is unconfigured, the template is
            missing, or the API call fails
        """
        owner_id = current_app.config.get('SENDCLEAN_OWNER_ID')
        token = current_app.config.get('SENDCLEAN_TOKEN')
        app_domain = current_app.config.get('SENDCLEAN_APP_DOMAIN')
        smtp_user = current_app.config.get('SENDCLEAN_SMTP_USER')
        from_email = current_app.config.get('SENDCLEAN_FROM_EMAIL')
        from_name = current_app.config.get('SENDCLEAN_FROM_NAME', 'LARAZEN')
        reply_to = None

        # Tenant sender identity. Separate gate from template overrides:
        # ``own_sender_ready`` additionally requires the sending domain to be
        # verified with the provider, because SendClean rejects an unverified
        # From — sending anyway would turn a cosmetic setting into mail that
        # silently never arrives. Same credentials either way; only the
        # from-address changes, which is why tenant email needs no per-tenant
        # secret the way tenant SMS does.
        _tenant_cfg = cls._tenant_email_config()
        if _tenant_cfg is not None and _tenant_cfg.own_sender_ready:
            from_email = _tenant_cfg.from_email
            from_name = _tenant_cfg.from_name or from_name
            reply_to = _tenant_cfg.reply_to or None

        template = cls._load_template(purpose)

        # ── Test-env containment (ENVIRONMENT_DESIGN §7) ─────────────
        # EMAIL_DRY_RUN: log the rendered mail and report it sent — no
        # HTTP call, no SendClean credentials needed. Checked BEFORE the
        # misconfig gate (the test env may have no SendClean app at
        # all). Default off ⇒ inert in production.
        if current_app.config.get('EMAIL_DRY_RUN'):
            preview = None
            if template:
                try:
                    preview = template['subject'].format(**{
                        'company_name': cls._resolve_company_name(),
                        'first_name': recipient_name or 'there',
                        **variables,
                    })
                except Exception:  # noqa: BLE001 — preview is best-effort
                    preview = None
            # WARNING level on purpose: the default threshold hides
            # INFO and this line is the QA read-out. Only fires with
            # EMAIL_DRY_RUN on. Raw variable values on render failure —
            # the OTP/link is what the tester came for.
            logger.warning(
                '[EMAIL:DRY-RUN] purpose=%s to=%s subject=%r vars=%s',
                purpose, to_email, preview,
                dict(variables) if preview is None else '-',
            )
            return {'dry_run': True}

        # EMAIL_REDIRECT_ALL_TO: deliver every outbound mail to one QA
        # inbox instead of the real recipient, with the original address
        # recorded in the subject — real delivery pipeline, zero risk of
        # mailing an actual user from the test env.
        redirect_to = (current_app.config.get('EMAIL_REDIRECT_ALL_TO')
                       or '').strip()
        original_recipient = to_email
        if redirect_to:
            to_email = redirect_to
        if not all([owner_id, token, app_domain, smtp_user, from_email]) or not template:
            logger.error(
                f"[EMAIL:SEND] ✗ misconfigured "
                f"(owner_id={'set' if owner_id else 'MISSING'}, "
                f"token={'set' if token else 'MISSING'}, "
                f"app_domain={app_domain or 'MISSING'}, "
                f"smtp_user={'set' if smtp_user else 'MISSING'}, "
                f"from={from_email or 'MISSING'}, "
                f"template[{purpose}]={'set' if template else 'MISSING'})"
            )
            raise ValueError("Email provider is not configured.")

        # Auto-fill common variables.
        variables.setdefault('company_name', cls._resolve_company_name())
        variables.setdefault('first_name', recipient_name or 'there')

        try:
            subject = template['subject'].format(**variables)
            html_body = template['body_template'].format(**variables)
        except KeyError as e:
            logger.error(f"[EMAIL:SEND] ✗ missing variable {e} for template '{purpose}'")
            raise ValueError("Failed to render email body.")

        if redirect_to:
            subject = f'[to: {original_recipient}] {subject}'

        text_body = cls._strip_html(html_body)

        url = f"https://api.{app_domain}/v1.0/messages/sendMail"
        payload = {
            'owner_id': owner_id,
            'token': token,
            'smtp_user_name': smtp_user,
            'message': {
                'html': html_body,
                'text': text_body,
                'subject': subject,
                'from_email': from_email,
                'from_name': from_name,
                'to': [
                    {
                        'email': to_email,
                        'name': recipient_name or to_email,
                        'type': 'to',
                    }
                ],
                # Open + click tracking on by default for transactional flows.
                'headers': {
                    'X-STes-TrackOpen': 'yes',
                    'X-STes-TrackClick': 'html',
                    'X-STes-Autotext': 'yes',
                },
            },
        }

        # Only sent when a tenant set one — omitted entirely otherwise, so
        # the vendor rail's payload is byte-identical to before.
        if reply_to:
            payload['message']['headers']['Reply-To'] = reply_to

        try:
            resp = requests.post(url, json=payload, timeout=10)
        except requests.RequestException as e:
            logger.error(f"[EMAIL:SEND] ✗ network error to {to_email}: {e}")
            raise ValueError("Failed to send email. Please try again.")

        if resp.status_code >= 400:
            logger.error(
                f"[EMAIL:SEND] ✗ HTTP {resp.status_code} for {to_email}: {resp.text[:300]}"
            )
            raise ValueError("Failed to send email. Please try again.")

        body = resp.json() if resp.content else {}
        # SendClean returns 200 with body.status='error' for app-level failures.
        if body.get('status') == 'error':
            logger.error(
                f"[EMAIL:SEND] ✗ SendClean error to {to_email}: "
                f"{body.get('name')} — {body.get('message')}"
            )
            raise ValueError("Failed to send email. Please try again.")

        logger.debug(
            f"[EMAIL:SEND] ✓ purpose={purpose}, to={to_email}, status={resp.status_code}"
        )
        return body

    # ── Convenience wrappers ─────────────────────────────────────

    # Map UserRole → welcome-email purpose (channel='email').
    # Doctors get the pending-approval variant; everyone else gets a
    # role-specific welcome. Roles without a dedicated template fall back
    # to the patient one (the most generic copy).
    _WELCOME_PURPOSE_BY_ROLE = {
        'patient':    'signup_welcome_patient',
        'pharmacy':   'signup_welcome_pharmacy',
        'sub_admin':  'signup_welcome_sub_admin',
        'doctor':     'signup_welcome_pending',
    }

    @classmethod
    def _send_safe(cls, purpose, user, **variables):
        """Wrapper used by every trigger below — best-effort send with
        ``recipient_name`` + ``first_name`` auto-populated from the user.
        Notification failures must NEVER break an auth/admin flow.

        Since the outbox (app/services/outbox.py) this ENQUEUES instead
        of calling SendClean in-request: the row is attempted
        immediately post-insert on a background thread and retried with
        backoff by the sweep — same never-raise contract for callers,
        but a provider hiccup no longer silently loses the message, and
        the request never blocks on SendClean's 10s timeout.
        """
        if not getattr(user, 'email', None):
            return False
        try:
            from app.services.outbox import enqueue_now
            row_id = enqueue_now(
                tenant_id=getattr(user, 'tenant_id', None),
                channel='email',
                recipient=user.email,
                purpose=purpose,
                payload={
                    'recipient_name': user.first_name or 'there',
                    'variables': {
                        'first_name': user.first_name or 'there',
                        **variables,
                    },
                },
            )
            return row_id is not None
        except Exception as e:  # noqa: BLE001 — never break the flow
            logger.warning(
                f"[EMAIL:{purpose.upper()}] enqueue failed for user={user.id}: {e}"
            )
            return False

    @classmethod
    def send_welcome_email(cls, user):
        """Welcome email after signup. Picks the role-specific variant.

        We *intentionally* refuse to send to an unverified address — the
        user just typed it, we have no proof of ownership, and emailing
        the legitimate owner of the address would be spam at best,
        phishing-bait at worst. The welcome email is fired again from
        the post-login email-verification flow once the address is
        confirmed.
        """
        if not getattr(user, 'email_verified', False):
            logger.info(
                f"[EMAIL:WELCOME] skipping — email not verified for user={user.id}"
            )
            return False
        role_value = (
            user.role.value
            if hasattr(user.role, 'value')
            else str(user.role)
        )
        purpose = cls._WELCOME_PURPOSE_BY_ROLE.get(
            role_value, 'signup_welcome_patient'
        )
        return cls._send_safe(purpose, user)

    @classmethod
    def send_email_verification_otp(cls, user, otp):
        """Send a 6-digit OTP to ``user.email`` for the post-login
        email-verification flow. We bypass the verified-email guard
        because that's the whole point of this email.

        SYNCHRONOUS and RAISING on purpose — the user is at a form
        waiting for this code, and both AuthService call sites implement
        fail-closed (delete the stored OTP + re-raise → the route 4xxes
        so the user retries). This wrapper used to swallow failures and
        return False, which made those fail-closed guards dead code: the
        route said "code sent" while nothing went out
        (contact_change_service already bypassed it for that reason).
        The affiliation caller wraps it in try/except and is unaffected.
        """
        if not user.email:
            return False
        cls.send_email(
            user.email,
            'verify_email_otp',
            recipient_name=user.first_name or 'there',
            first_name=user.first_name or 'there',
            otp=otp,
        )
        return True

    @classmethod
    def send_password_reset_email(cls, user, otp):
        """Send the password-reset OTP via email; complements the SMS path."""
        return cls._send_safe('reset_pw_email', user, otp=otp)

    @classmethod
    def send_password_changed_email(cls, user, timestamp):
        """Confirmation email after a successful password change (NOT reset).
        ``timestamp`` is a pre-formatted, human-readable string.
        """
        return cls._send_safe('password_changed', user, timestamp=timestamp)

    @classmethod
    def send_logout_all_email(cls, user, timestamp):
        """Sent when all sessions are revoked (user-initiated or automated).
        ``timestamp`` is a pre-formatted, human-readable string.
        """
        return cls._send_safe('logout_all', user, timestamp=timestamp)

    @classmethod
    def send_account_locked_email(cls, user, unlock_time):
        """Sent after N failed login attempts trip the lockout.
        ``unlock_time`` is a pre-formatted, human-readable string.
        """
        return cls._send_safe('account_locked', user, unlock_time=unlock_time)

    @classmethod
    def send_doctor_approved_email(cls, user, login_url):
        """Sent when an admin approves a doctor's verification."""
        return cls._send_safe('doctor_approved', user, login_url=login_url)

    @classmethod
    def send_doctor_rejected_email(cls, user, reason):
        """Sent when an admin rejects a doctor's verification.
        ``reason`` is admin-supplied free text.
        """
        return cls._send_safe('doctor_rejected', user, reason=reason or 'Not specified')

    @classmethod
    def send_tenant_ready_email(cls, user, dashboard_url):
        """Sent to the tenant owner after Cloudflare DNS + RLS bootstrap completes."""
        return cls._send_safe('tenant_ready', user, dashboard_url=dashboard_url)

    @classmethod
    def send_login_alert_email(cls, user, device, location, timestamp):
        """Sent when a sign-in fingerprint differs from prior sessions.
        Wiring deferred until fingerprint-diff logic exists.
        """
        return cls._send_safe(
            'login_alert', user,
            device=device, location=location, timestamp=timestamp,
        )

    @classmethod
    def send_staff_invited_email(cls, to_email, first_name, inviter_name, accept_url):
        """Sent to invited staff (no User row exists yet — accepts raw
        fields). Enqueued to the outbox; the tenant comes from the
        request context (invites are always sent from an admin session).
        Falls back to a direct send only if no tenant is resolvable.
        """
        try:
            from app.common.tenant_context import current_tenant_id
            tenant_id = current_tenant_id()
            if tenant_id:
                from app.services.outbox import enqueue_now
                return enqueue_now(
                    tenant_id=tenant_id,
                    channel='email',
                    recipient=to_email,
                    purpose='staff_invited',
                    payload={
                        'recipient_name': first_name or 'there',
                        'variables': {
                            'first_name': first_name or 'there',
                            'inviter_name': inviter_name,
                            'accept_url': accept_url,
                        },
                    },
                ) is not None
            cls.send_email(
                to_email,
                'staff_invited',
                recipient_name=first_name or 'there',
                first_name=first_name or 'there',
                inviter_name=inviter_name,
                accept_url=accept_url,
            )
            return True
        except Exception as e:
            logger.warning(f"[EMAIL:STAFF_INVITED] non-fatal failure for {to_email}: {e}")
            return False
