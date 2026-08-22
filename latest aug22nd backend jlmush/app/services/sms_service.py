"""
Combirds (Edumarc) SMS Service with OTP Support.

Replaces the AWS SES email path for all auth flows (signup, login OTP,
password reset, phone-number verification). The provider is multi-channel
(SMS / email / WhatsApp) but only SMS is wired here — email is intentionally
bypassed until Combirds email is integrated.

Templates are NOT hard-coded or env-driven; they live in the
``notification_templates`` table and are looked up by ``purpose``
(``login_otp``, ``signup_otp``, ``reset_pw_otp``, ``verify_phone_otp``,
plus whatever else gets seeded as the platform grows). Each row holds the
DLT template ID, the DLT-approved sender header, the body format-string,
and the ordered variable names the body expects.

Lookups are cached in Redis under ``sms_template:<purpose>`` for
``TEMPLATE_CACHE_TTL`` seconds. Updates to the DB row should call
:meth:`SMSService.invalidate_template_cache` so the next request picks
up the new wording without a process restart.
"""
import json
import logging
import random
import re
import string

import requests
from flask import current_app

logger = logging.getLogger(__name__)


class SMSService:
    """Combirds SMS service for transactional SMS and OTP."""

    # Redis key prefixes (kept distinct from any legacy email keys)
    PHONE_OTP_PREFIX = "phone_otp:"
    PRE_SIGNUP_PHONE_OTP_PREFIX = "pre_signup_phone_otp:"
    OTP_TTL_SECONDS = 600  # 10 minutes

    TEMPLATE_CACHE_PREFIX = "sms_template:"
    TEMPLATE_CACHE_TTL = 300  # 5 minutes

    # Fallback chain — when the operator hasn't configured a row for the
    # requested ``purpose`` yet, we land on a sibling template that's
    # known to be DLT-approved instead of 500ing the auth flow. The
    # signup OTP is the universal fallback for any OTP-style purpose
    # (login / reset-pw / phone-verify / clinic-signup-otp / etc.) —
    # those bodies all look like "Your OTP is ..." and DLT pre-approves
    # them under a single header. Surfaced via WARNING-level log so it's
    # obvious which template still needs configuring.
    _PURPOSE_FALLBACKS = {
        'login_otp':         'signup_otp',
        'reset_pw_otp':      'signup_otp',
        'verify_phone_otp':  'signup_otp',
        # Future-proof: any provider-onboarding OTP variants (clinic
        # admin, hospital admin, pharmacy admin) reuse the same signup
        # OTP body. Add the explicit row here so the log spells out
        # which purpose was substituted instead of the operator
        # guessing why their template never fired.
        'clinic_signup_otp':   'signup_otp',
        'hospital_signup_otp': 'signup_otp',
        'pharmacy_signup_otp': 'signup_otp',
        'activation_otp':      'signup_otp',
    }

    @staticmethod
    def _get_redis_client():
        from app.extensions import redis_client
        return redis_client

    @staticmethod
    def generate_otp(length=6):
        return ''.join(random.choices(string.digits, k=length))

    # ── Template registry lookup ─────────────────────────────────

    @classmethod
    def _tenant_dlt_config(cls):
        """The current tenant's own-DLT config, IF they are structurally
        ready AND their plan grants ``communication.custom_sms``. None →
        the common (vendor) rail applies. Never raises — SMS must keep
        flowing on the common rail when anything here misbehaves."""
        try:
            from app.common.tenant_context import current_tenant_id
            from app.models import TenantSmsConfig
            tenant_id = current_tenant_id()
            if not tenant_id:
                return None
            config = TenantSmsConfig.for_tenant(tenant_id)
            if config is None or not config.own_dlt_ready:
                return None
            from app.api.pricing.service import FeatureGate
            if not FeatureGate.is_enabled(tenant_id, 'communication.custom_sms'):
                return None
            return config
        except Exception as e:  # noqa: BLE001
            logger.debug(f"[SMS] tenant DLT config lookup failed: {e}")
            return None

    @staticmethod
    def _load_tenant_template(config, purpose):
        """The tenant's own DLT-approved template for ``purpose``, or None.
        Not Redis-cached: it's one JSONB field on a row we already loaded,
        and keeping tenant payloads out of the shared cache keeps the
        common-rail keys tenant-agnostic."""
        entry = (config.templates or {}).get(purpose) or {}
        if not entry.get('template_id') or not entry.get('body_template'):
            return None
        return {
            'template_id': entry['template_id'],
            'sender_id': config.sender_id,
            'body_template': entry['body_template'],
            'variable_names': entry.get('variable_names') or [],
            'channel': 'sms',
            'rail': 'tenant',
        }

    @classmethod
    def _load_template(cls, purpose):
        """Return the template payload for ``purpose``.

        Resolution order:
          1. the tenant's OWN DLT template (plan-gated, per-purpose) —
             a body approved under the vendor's principal entity can't
             ship under the tenant's header, so there is no mixing;
          2. the common (vendor) registry row, cached in Redis;
          3. the purpose's fallback row from ``_PURPOSE_FALLBACKS``.

        Returns ``None`` only when none of those exist.
        """
        config = cls._tenant_dlt_config()
        if config is not None:
            payload = cls._load_tenant_template(config, purpose)
            if payload:
                return payload
            logger.warning(
                "[SMS:TEMPLATE] tenant %s uses own DLT but has no '%s' "
                "template — falling back to the common rail for this send.",
                config.tenant_id, purpose,
            )

        payload = cls._load_template_for_purpose(purpose)
        if payload:
            return payload

        fallback = cls._PURPOSE_FALLBACKS.get(purpose)
        if not fallback or fallback == purpose:
            return None

        payload = cls._load_template_for_purpose(fallback)
        if payload:
            # Loud-but-not-fatal: lets the operator find this in CloudWatch
            # and configure the dedicated row when they get to it.
            logger.warning(
                "[SMS:TEMPLATE] purpose '%s' not configured — falling back to "
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
                # Corrupt cache entry — fall through to DB and overwrite.
                logger.warning(f"[SMS:TEMPLATE] corrupt cache for {purpose}, refreshing")

        from app.models import NotificationTemplate
        row = NotificationTemplate.query.filter_by(
            purpose=purpose, channel='sms', is_active=True,
        ).first()
        if not row:
            return None

        payload = {
            'template_id': row.template_id,
            'sender_id': row.sender_id,
            'body_template': row.body_template,
            'variable_names': row.variable_names or [],
            'channel': row.channel,
        }
        if redis:
            try:
                redis.setex(cache_key, cls.TEMPLATE_CACHE_TTL, json.dumps(payload))
            except Exception as e:
                logger.debug(f"[SMS:TEMPLATE] cache write failed: {e}")
        return payload

    @classmethod
    def invalidate_template_cache(cls, purpose=None):
        """Drop the cached entry for ``purpose`` (or all entries if None).

        Call from admin endpoints whenever a template row is created /
        updated / deactivated so the new wording goes live immediately.
        """
        redis = cls._get_redis_client()
        if not redis:
            return
        if purpose:
            redis.delete(f"{cls.TEMPLATE_CACHE_PREFIX}{purpose}")
            return
        # Wildcard wipe — use SCAN to avoid blocking Redis on large keysets.
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
        """Pull the tenant's display name for the ``{company_name}`` slot.

        Falls back to ``LARAZN`` when there's no tenant on the request —
        keeps SMS deliverable in non-tenant flows without leaking
        ``None`` into the message.
        """
        try:
            from app.common.tenant_context import current_tenant_id
            from app.models import Tenant
            tid = current_tenant_id()
            if tid:
                t = Tenant.query.get(tid)
                if t and t.name:
                    return t.name
        except Exception as e:
            logger.debug(f"[SMS] tenant lookup failed: {e}")
        return 'LARAZN'

    @staticmethod
    def _lookup_first_name_by_phone(phone_number):
        """Find the user attached to ``phone_number`` in the current tenant
        and return their first name. Returns ``None`` when no user matches
        — caller decides whether that means "skip send" (login OTP) or
        "send anyway with a generic salutation" (anonymous flows).
        """
        try:
            from app.common.encryption import hash_for_search
            from app.common.tenant_context import current_tenant_id_or_default
            from app.models import User
            tenant_id = current_tenant_id_or_default()
            phone_hash = hash_for_search(phone_number)
            user = User.query.filter_by(
                _phone_hash=phone_hash, tenant_id=tenant_id, is_deleted=False,
            ).first()
            return (user.first_name or 'there') if user else None
        except Exception as e:
            logger.debug(f"[SMS] user lookup by phone failed: {e}")
            return None

    @staticmethod
    def _normalize_phone(phone_number):
        """Edumarc accepts plain 10-digit Indian numbers."""
        n = ''.join(ch for ch in str(phone_number) if ch.isdigit() or ch == '+')
        if n.startswith('+91'):
            n = n[3:]
        elif n.startswith('91') and len(n) == 12:
            n = n[2:]
        return n

    # ── Send ─────────────────────────────────────────────────────

    @classmethod
    def _sms_allowlist(cls):
        """Normalized numbers that always send for REAL (team phones)."""
        raw = current_app.config.get('SMS_ALLOWLIST') or ''
        return {cls._normalize_phone(p) for p in raw.split(',') if p.strip()}

    @classmethod
    def _sms_dry_run_for(cls, normalized_number):
        """ENVIRONMENT_DESIGN §7 — is this send contained? True when
        SMS_DRY_RUN is on and the number is NOT allowlisted."""
        if not current_app.config.get('SMS_DRY_RUN'):
            return False
        return normalized_number not in cls._sms_allowlist()

    @classmethod
    def send_sms(cls, phone_number, purpose, **variables):
        """Send an SMS for ``purpose``.

        ``variables`` are interpolated into the template body by name.
        ``company_name`` is auto-filled from the tenant context when not
        supplied. Raises :class:`ValueError` on misconfig / send failure
        — callers in the auth flow turn that into a 4xx for the user.
        """
        template = cls._load_template(purpose)

        # ── Test-env containment (ENVIRONMENT_DESIGN §7) ─────────────
        # Combirds has no sandbox, so the app is one: with SMS_DRY_RUN
        # on, the rendered message is logged and reported SENT — no
        # HTTP call, no credentials required, no spend (the fail-closed
        # OTP flow keeps its stored OTP because this "send" succeeds).
        # Allowlisted numbers fall through to the real path below.
        # Checked BEFORE the credential/template-id gates: the test env
        # may legitimately have neither. Logging the full body (OTP
        # included) is deliberate — test logs are the QA read-out.
        dry_number = cls._normalize_phone(phone_number)
        if cls._sms_dry_run_for(dry_number):
            # The real transport refuses garbage numbers; the sandbox
            # must too, or the fail-closed OTP contract (malformed →
            # 4xx, harness-enforced) silently weakens on the test env.
            if not re.match(r'^[6-9]\d{9}$', dry_number):
                raise ValueError('Invalid phone number.')
            preview = None
            if template:
                try:
                    preview = template['body_template'].format(**{
                        'company_name': cls._resolve_company_name(),
                        'first_name': 'there',
                        **variables,
                    })
                except Exception:  # noqa: BLE001 — preview is best-effort
                    preview = None
            # WARNING level on purpose: the app's default threshold
            # hides INFO, and this line IS the QA read-out (the OTP
            # lives in it). It can only ever fire with SMS_DRY_RUN on.
            # When the template can't render (missing row / extra
            # placeholders), fall back to the raw variable VALUES —
            # names alone would hide the OTP the tester needs.
            logger.warning(
                '[SMS:DRY-RUN] purpose=%s to=%s body=%r vars=%s',
                purpose, dry_number, preview,
                dict(variables) if preview is None else '-',
            )
            return {'dry_run': True}

        # Credentials follow the template's rail: a tenant-DLT template
        # ships over the tenant's own Combirds account; everything else
        # (common registry + fallbacks) over the platform account.
        if template and template.get('rail') == 'tenant':
            config = cls._tenant_dlt_config()
            api_key = config.combirds_api_key if config else None
            url = ((config.combirds_sms_url if config else None)
                   or current_app.config.get('COMBIRDS_SMS_URL'))
        else:
            api_key = current_app.config.get('COMBIRDS_API_KEY')
            url = current_app.config.get('COMBIRDS_SMS_URL')

        if not api_key or not url or not template:
            logger.error(
                f"[SMS:SEND] ✗ misconfigured (api_key={'set' if api_key else 'MISSING'}, "
                f"url={'set' if url else 'MISSING'}, "
                f"template[{purpose}]={'set' if template else 'MISSING'})"
            )
            raise ValueError("SMS provider is not configured. Please contact support.")

        if not template.get('template_id'):
            logger.error(
                f"[SMS:SEND] ✗ template '{purpose}' has no DLT id yet — "
                f"fill notification_templates.template_id"
            )
            raise ValueError("SMS template not yet approved by carrier.")

        variables.setdefault('company_name', cls._resolve_company_name())
        # Pre-signup OTP flows don't know the user's first_name yet
        # (account doesn't exist). Default to a polite placeholder so the
        # DLT-approved body still renders. Once the frontend forwards
        # ``first_name`` on /pre-signup/send-phone-otp this fallback only
        # fires for the small windows where a name truly isn't available.
        variables.setdefault('first_name', 'there')

        try:
            message = template['body_template'].format(**variables)
        except KeyError as e:
            logger.error(f"[SMS:SEND] ✗ missing variable {e} for template '{purpose}'")
            raise ValueError("Failed to render SMS body. Please contact support.")

        number = cls._normalize_phone(phone_number)
        body = {
            'message': message,
            'senderId': template['sender_id'],
            'number': [number],
            'templateId': template['template_id'],
        }
        headers = {'Content-Type': 'application/json', 'apikey': api_key}

        try:
            resp = requests.post(url, json=body, headers=headers, timeout=10)
        except requests.RequestException as e:
            logger.error(f"[SMS:SEND] ✗ network error to {number}: {e}")
            raise ValueError("Failed to send SMS. Please try again.")

        if resp.status_code >= 400:
            logger.error(
                f"[SMS:SEND] ✗ HTTP {resp.status_code} for {number}: {resp.text[:300]}"
            )
            raise ValueError("Failed to send SMS. Please try again.")

        logger.debug(
            f"[SMS:SEND] ✓ purpose={purpose}, to={number}, status={resp.status_code}"
        )
        return resp.json() if resp.content else {}

    # ── OTP helpers ──────────────────────────────────────────────

    @classmethod
    def _qa_static_otp_for(cls, normalized_number):
        """ENVIRONMENT_DESIGN §7 — a FIXED OTP for allowlisted QA numbers
        only, so login/signup flows are testable on the test env without
        SMS. Per-number gate + code from env means an internet-reachable
        test box doesn't grow a universal backdoor; both vars are unset
        in production."""
        code = (current_app.config.get('QA_STATIC_OTP') or '').strip()
        if not code:
            return None
        allow = {cls._normalize_phone(p)
                 for p in (current_app.config.get('QA_OTP_ALLOWLIST') or '')
                 .split(',') if p.strip()}
        return code if normalized_number in allow else None

    @classmethod
    def _send_and_store_otp(cls, phone_number, purpose, key_prefix, **extra_vars):
        redis = cls._get_redis_client()
        normalized = cls._normalize_phone(phone_number)
        otp = cls._qa_static_otp_for(normalized) or cls.generate_otp()
        key = f"{key_prefix}{normalized}"
        redis.setex(key, cls.OTP_TTL_SECONDS, otp)

        try:
            cls.send_sms(phone_number, purpose, otp=otp, **extra_vars)
        except Exception:
            redis.delete(key)
            raise
        return True

    @classmethod
    def _verify_otp(cls, phone_number, otp, key_prefix, consume=True):
        redis = cls._get_redis_client()
        key = f"{key_prefix}{cls._normalize_phone(phone_number)}"
        stored = redis.get(key)
        if stored is None:
            return False
        if isinstance(stored, bytes):
            stored = stored.decode('utf-8')
        if stored != otp:
            return False
        if consume:
            redis.delete(key)
        return True

    # Pre-signup (account doesn't exist yet)
    @classmethod
    def send_pre_signup_phone_otp(cls, phone_number, first_name=None):
        """``first_name`` is optional — render the personalized DLT body
        when supplied, fall back to "there" when the frontend hasn't
        collected it yet (older signup forms or resend flows).
        """
        extra = {}
        if first_name:
            extra['first_name'] = first_name
        return cls._send_and_store_otp(
            phone_number, 'signup_otp', cls.PRE_SIGNUP_PHONE_OTP_PREFIX,
            **extra,
        )

    @classmethod
    def verify_pre_signup_phone_otp(cls, phone_number, otp):
        return cls._verify_otp(
            phone_number, otp, cls.PRE_SIGNUP_PHONE_OTP_PREFIX
        )

    # Post-signup phone verification / passwordless login.
    #
    # ``login_otp`` requires a real account — we look the user up by phone
    # and salt the SMS with their first_name. If no user matches, return
    # success silently to avoid leaking which numbers are registered
    # (user enumeration defense). The /verify step will still fail closed
    # because no OTP was stored.
    @classmethod
    def send_phone_otp(cls, phone_number, purpose='login_otp'):
        if purpose == 'login_otp':
            first_name = cls._lookup_first_name_by_phone(phone_number)
            if first_name is None:
                logger.debug(
                    f"[SMS:LOGIN_OTP] phone not registered; returning success without send"
                )
                return True
            return cls._send_and_store_otp(
                phone_number, purpose, cls.PHONE_OTP_PREFIX,
                first_name=first_name,
            )
        return cls._send_and_store_otp(phone_number, purpose, cls.PHONE_OTP_PREFIX)

    @classmethod
    def verify_phone_otp(cls, phone_number, otp):
        return cls._verify_otp(phone_number, otp, cls.PHONE_OTP_PREFIX)

    # Password reset OTP — caller resolved the user already, so they pass
    # the first_name in directly. This method just pushes the SMS; the
    # OTP→token mapping in Redis is owned by AuthService.request_password_reset.
    @classmethod
    def send_reset_password_otp(cls, phone_number, otp, first_name='there'):
        cls.send_sms(phone_number, 'reset_pw_otp', otp=otp, first_name=first_name)
        return True

    # ── Notification wrappers (mirror EmailService) ──────────────
    # Each wrapper is best-effort — SMS failures must NEVER break the
    # auth/admin flow that triggered them. Returns True on send, False on
    # any failure (logged at WARN). Caller passes the ``user`` (or raw
    # phone for invite-style flows where no User row exists yet).

    @classmethod
    def _notify_safe(cls, user, purpose, **variables):
        """Internal helper — pulls phone + first_name off ``user``.
        Logs + swallows failures.

        Since the outbox (app/services/outbox.py) this ENQUEUES instead
        of calling Combirds in-request: attempted immediately on a
        background thread, retried with backoff, never blocks the
        request, never silently lost. OTP flows do NOT come through
        here — they stay synchronous fail-closed by design.
        """
        if not getattr(user, 'phone_number', None):
            return False
        try:
            from app.services.outbox import enqueue_now
            row_id = enqueue_now(
                tenant_id=getattr(user, 'tenant_id', None),
                channel='sms',
                recipient=user.phone_number,
                purpose=purpose,
                payload={'variables': {
                    'first_name': user.first_name or 'there',
                    **variables,
                }},
            )
            return row_id is not None
        except Exception as e:  # noqa: BLE001 — never break the flow
            logger.warning(
                f"[SMS:{purpose.upper()}] enqueue failed for user={user.id}: {e}"
            )
            return False

    @classmethod
    def send_logout_all_sms(cls, user):
        """SMS sibling of EmailService.send_logout_all_email."""
        return cls._notify_safe(user, 'logout_all')

    @classmethod
    def send_login_alert_sms(cls, user):
        """SMS sibling of EmailService.send_login_alert_email.
        Body is fixed-format — no device/location/timestamp slots.
        """
        return cls._notify_safe(user, 'login_alert')

    @classmethod
    def send_doctor_approved_sms(cls, user):
        """SMS sibling of EmailService.send_doctor_approved_email."""
        return cls._notify_safe(user, 'doctor_approved')

    @classmethod
    def send_doctor_rejected_sms(cls, user):
        """SMS sibling of EmailService.send_doctor_rejected_email.
        DLT body has no {reason} slot — reason ships only in the email.
        """
        return cls._notify_safe(user, 'doctor_rejected')

    @classmethod
    def send_tenant_ready_sms(cls, user, company_name=None):
        """SMS sibling of EmailService.send_tenant_ready_email.
        ``company_name`` is passed explicitly because the request runs
        under the platform-owner's tenant context, not the new tenant's.
        """
        extra = {}
        if company_name:
            extra['company_name'] = company_name
        return cls._notify_safe(user, 'tenant_ready', **extra)

    @classmethod
    def send_staff_invited_sms(cls, phone_number, first_name, company_name):
        """SMS sibling of EmailService.send_staff_invited_email.
        Accepts raw fields because no User row exists at invite time.
        Enqueued when a tenant is resolvable from the request (invites
        always are); direct send as the fallback.
        """
        try:
            from app.common.tenant_context import current_tenant_id
            tenant_id = current_tenant_id()
            if tenant_id:
                from app.services.outbox import enqueue_now
                return enqueue_now(
                    tenant_id=tenant_id,
                    channel='sms',
                    recipient=phone_number,
                    purpose='staff_invited',
                    payload={'variables': {
                        'first_name': first_name or 'there',
                        'company_name': company_name,
                    }},
                ) is not None
            cls.send_sms(
                phone_number, 'staff_invited',
                first_name=first_name or 'there',
                company_name=company_name,
            )
            return True
        except Exception as e:
            logger.warning(f"[SMS:STAFF_INVITED] non-fatal failure for {phone_number}: {e}")
            return False
