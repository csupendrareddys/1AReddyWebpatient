"""Self-service phone/email change — OTP verification of the NEW contact.

One small service used by both the patient flow (verify → apply immediately)
and the doctor flow (verify → submit a FieldApprovalRequest that an admin
approves before it takes effect). It owns only the OTP challenge: generate a
6-digit code, store it in Redis bound to (channel, new value), deliver it via
the same SMS / email senders production already uses, and verify it. Applying
the change (immediate vs. approval) is the caller's job.
"""
import logging
import random

from app.common.encryption import hash_for_search

logger = logging.getLogger(__name__)


class ContactChangeService:
    CHANNELS = ('phone', 'email')
    _TTL_SECONDS = 600  # 10 minutes
    _KEY_PREFIX = 'contact_change_otp:'

    # ── helpers ────────────────────────────────────────────────────────
    @staticmethod
    def _redis():
        from app.extensions import get_redis_client
        client = get_redis_client()
        if client is None:
            raise ValueError('Verification is temporarily unavailable — please try again.')
        return client

    @staticmethod
    def normalize(channel, value):
        value = (value or '').strip()
        if channel == 'email':
            value = value.lower()
        return value

    @classmethod
    def _key(cls, channel, value):
        return f"{cls._KEY_PREFIX}{channel}:{cls.normalize(channel, value)}"

    @staticmethod
    def _validate_format(channel, value):
        if channel not in ContactChangeService.CHANNELS:
            raise ValueError('Invalid channel — expected "phone" or "email".')
        if not value:
            raise ValueError('A new value is required.')
        if channel == 'email' and '@' not in value:
            raise ValueError('Please enter a valid email address.')
        if channel == 'phone':
            digits = ''.join(ch for ch in value if ch.isdigit())
            if len(digits) < 10:
                raise ValueError('Please enter a valid phone number.')

    @staticmethod
    def assert_unique(user, channel, value):
        """No OTHER active user in this tenant may already hold this value."""
        from app.models import User
        col = User._phone_hash if channel == 'phone' else User._email_hash
        clash = User.query.filter(
            col == hash_for_search(ContactChangeService.normalize(channel, value)),
            User.tenant_id == user.tenant_id,
            User.id != user.id,
            User.is_deleted == False,  # noqa: E712
        ).first()
        if clash:
            label = 'phone number' if channel == 'phone' else 'email'
            raise ValueError(f'This {label} is already registered to another user.')

    # ── public API ─────────────────────────────────────────────────────
    @classmethod
    def send_otp(cls, user, channel, value):
        """Validate + guard uniqueness, then deliver a fresh OTP to the NEW
        contact. Raises ValueError on a bad/duplicate value or a delivery
        failure (the stored code is rolled back on delivery failure)."""
        channel = (channel or '').strip().lower()
        value = cls.normalize(channel, value)
        cls._validate_format(channel, value)
        cls.assert_unique(user, channel, value)

        otp = str(random.randint(100000, 999999))
        key = cls._key(channel, value)
        cls._redis().setex(key, cls._TTL_SECONDS, otp)

        first_name = getattr(user, 'first_name', None) or 'there'
        try:
            if channel == 'phone':
                from app.services.sms_service import SMSService
                # send_sms RAISES ValueError on misconfig / unapproved template /
                # send failure — surfaced below so the user never sees a false
                # "code sent".
                SMSService.send_sms(value, 'signup_otp', otp=otp, first_name=first_name)
            else:
                from app.services.email_service import EmailService
                # Call send_email DIRECTLY: it RAISES a descriptive ValueError on
                # misconfig ("Email provider is not configured"), a missing
                # template, or a send failure. The convenience wrapper
                # send_email_verification_otp SWALLOWS those (returns False),
                # which previously made a failed email look like success.
                EmailService.send_email(
                    value, 'verify_email_otp',
                    recipient_name=first_name, first_name=first_name, otp=otp,
                )
        except ValueError:
            # Descriptive provider error — roll back the stored code and let the
            # exact reason reach the user + logs.
            cls._redis().delete(key)
            logger.exception('[CONTACT_CHANGE] OTP delivery failed for %s', channel)
            raise
        except Exception:
            cls._redis().delete(key)
            logger.exception('[CONTACT_CHANGE] OTP delivery failed for %s', channel)
            raise ValueError('Could not send the verification code — please try again.')
        return True

    @classmethod
    def verify_otp(cls, channel, value, otp):
        """True iff ``otp`` matches the code sent for (channel, value). Consumes
        the code on success so it can't be replayed."""
        channel = (channel or '').strip().lower()
        if channel not in cls.CHANNELS:
            return False
        key = cls._key(channel, value)
        stored = cls._redis().get(key)
        if stored is None:
            return False
        if isinstance(stored, bytes):
            stored = stored.decode('utf-8')
        if str(stored) != str(otp or '').strip():
            return False
        cls._redis().delete(key)
        return True
