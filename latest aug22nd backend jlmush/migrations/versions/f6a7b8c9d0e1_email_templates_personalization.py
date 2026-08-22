"""Email templates + name personalization for the notification registry.

Schema changes
--------------
* Add ``subject`` (text, nullable) — populated for email rows, NULL for SMS.
* Replace the ``UNIQUE(purpose)`` constraint with ``UNIQUE(channel, purpose)``
  so SMS and email rows can share a purpose key (e.g. ``reset_pw_otp``
  exists once for SMS and once for email).

Data changes
------------
* Update the SMS ``login_otp`` and ``reset_pw_otp`` bodies to start with
  ``Hi {first_name},`` — adds a third variable in the ordered slot list.
  These need to be re-submitted to DLT under the new wording before the
  ``template_id`` column can be filled in.
* Insert email rows for ``signup_welcome`` (patient/pharmacy/etc.),
  ``signup_welcome_pending`` (doctor — mentions "pending approval"), and
  ``reset_pw_email``. Bodies are HTML; ``subject`` is set; the SendClean
  side does not need template IDs because we POST raw HTML via
  ``/messages/sendMail``.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-26
"""
from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op


revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


# Updated SMS bodies — name-personalized, period-separated, LARAZN
# footer. Wording MUST match the bulk CSV submitted to VI DLT
# (Backend/scripts/dlt_bulk_templates.csv) char-for-char or carrier
# gateways will reject mid-send.
LOGIN_OTP_BODY = (
    "Hi {first_name}. {otp} is your OTP to log in to {company_name}. "
    "Valid 10 min. Don't share. - LARAZN"
)
SIGNUP_OTP_BODY = (
    "Hi {first_name}. {otp} is your code to create your account on "
    "{company_name}. Valid 10 min. Don't share. - LARAZN"
)
RESET_PW_BODY = (
    "Hi {first_name}. {otp} is your OTP to reset your password on "
    "{company_name}. Valid 10 min. Don't share. - LARAZN"
)
VERIFY_PHONE_BODY = (
    "Hi {first_name}. {otp} is your OTP to verify your mobile number on "
    "{company_name}. Valid 10 min. Don't share. - LARAZN"
)


# Email templates. Body is HTML; subject is the email subject line.
WELCOME_PATIENT_SUBJECT = 'Welcome to {company_name}!'
WELCOME_PATIENT_HTML = """\
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333">
<div style="max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#1976d2">Welcome, {first_name}!</h2>
  <p>Your account on <strong>{company_name}</strong> is ready.</p>
  <p>You can now book appointments with verified doctors, manage your
  health records, and view prescriptions.</p>
  <p>If you didn't create this account, please ignore this email or
  contact your clinic.</p>
  <p style="margin-top:30px;color:#888;font-size:12px">- The {company_name} team</p>
</div></body></html>
"""

WELCOME_DOCTOR_SUBJECT = 'Welcome to {company_name} — verification in progress'
WELCOME_DOCTOR_HTML = """\
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333">
<div style="max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#1976d2">Welcome, Dr. {first_name}</h2>
  <p>Thank you for registering with <strong>{company_name}</strong>.</p>
  <p>Your account is currently <strong>pending admin approval</strong>.
  Our team will review your registration certificate, qualifications and
  Aadhaar details and activate your account once verified — usually
  within 1-2 business days.</p>
  <p>You'll receive another email the moment your account is active.</p>
  <p style="margin-top:30px;color:#888;font-size:12px">- The {company_name} team</p>
</div></body></html>
"""

RESET_PW_EMAIL_SUBJECT = 'Reset your {company_name} password'
RESET_PW_EMAIL_HTML = """\
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333">
<div style="max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#1976d2">Password reset request</h2>
  <p>Hi {first_name},</p>
  <p>We received a request to reset your password for your
  <strong>{company_name}</strong> account.</p>
  <p>Your one-time password is:</p>
  <div style="font-size:32px;font-weight:bold;color:#1976d2;
              letter-spacing:8px;padding:18px;background:#f0f7ff;
              text-align:center;border-radius:8px;margin:20px 0;
              border:2px dashed #1976d2">{otp}</div>
  <p>This OTP is valid for 10 minutes. If you didn't request a reset,
  you can safely ignore this email — your password will not be changed.</p>
  <p style="margin-top:30px;color:#888;font-size:12px">- The {company_name} team</p>
</div></body></html>
"""


EMAIL_SEED_ROWS = [
    {
        'purpose': 'signup_welcome',
        'name': 'Welcome email — patient / general',
        'subject': WELCOME_PATIENT_SUBJECT,
        'body_template': WELCOME_PATIENT_HTML,
        'variable_names': ['first_name', 'company_name'],
        'notes': 'Sent immediately after non-doctor signup completes.',
    },
    {
        'purpose': 'signup_welcome_pending',
        'name': 'Welcome email — doctor (pending approval)',
        'subject': WELCOME_DOCTOR_SUBJECT,
        'body_template': WELCOME_DOCTOR_HTML,
        'variable_names': ['first_name', 'company_name'],
        'notes': 'Sent after doctor signup; reassures them about the manual review wait.',
    },
    {
        'purpose': 'reset_pw_email',
        'name': 'Password reset — email channel',
        'subject': RESET_PW_EMAIL_SUBJECT,
        'body_template': RESET_PW_EMAIL_HTML,
        'variable_names': ['first_name', 'otp', 'company_name'],
        'notes': 'Sent in parallel with reset_pw_otp SMS when the user has an email on file.',
    },
]


def upgrade():
    # ── Schema ───────────────────────────────────────────────────
    op.add_column(
        'notification_templates',
        sa.Column('subject', sa.Text, nullable=True),
    )

    # Drop old single-column unique on purpose; add composite (channel, purpose).
    # The original migration created it via ``unique=True`` on the column
    # (auto-named) AND an explicit unique index. Drop both forms defensively.
    op.execute(
        "ALTER TABLE notification_templates "
        "DROP CONSTRAINT IF EXISTS notification_templates_purpose_key"
    )
    op.execute("DROP INDEX IF EXISTS ix_notification_templates_purpose")
    op.create_index(
        'ix_notification_templates_purpose',
        'notification_templates', ['purpose'],
        unique=False,
    )
    op.create_unique_constraint(
        'uq_notification_templates_channel_purpose',
        'notification_templates', ['channel', 'purpose'],
    )

    bind = op.get_bind()

    # ── Align all 4 SMS bodies to the bulk CSV submitted to VI DLT ──
    # Same variable order across all four: [first_name, otp, company_name].
    # ``sender_id`` flips from LARAZN to LARAZN to match the rebrand.
    sms_updates = [
        ('login_otp',         LOGIN_OTP_BODY),
        ('signup_otp',        SIGNUP_OTP_BODY),
        ('reset_pw_otp',      RESET_PW_BODY),
        ('verify_phone_otp',  VERIFY_PHONE_BODY),
    ]
    for purpose, body in sms_updates:
        bind.execute(
            sa.text(
                """
                UPDATE notification_templates
                   SET body_template  = :body,
                       variable_names = CAST(:vars AS JSONB),
                       sender_id      = 'LARAZN',
                       notes          = :notes
                 WHERE purpose = :purpose AND channel = 'sms'
                """
            ),
            {
                'purpose': purpose,
                'body': body,
                'vars': json.dumps(['first_name', 'otp', 'company_name']),
                'notes': 'Body matches scripts/dlt_bulk_templates.csv. '
                         'Fill template_id once VI DLT approves the bulk submission.',
            },
        )

    # ── Seed email rows ─────────────────────────────────────────
    for row in EMAIL_SEED_ROWS:
        bind.execute(
            sa.text(
                """
                INSERT INTO notification_templates
                    (id, purpose, name, channel, template_id, sender_id,
                     subject, body_template, variable_names,
                     is_active, notes)
                VALUES
                    (:id, :purpose, :name, 'email', NULL, 'LARAZN',
                     :subject, :body, CAST(:vars AS JSONB),
                     TRUE, :notes)
                """
            ),
            {
                'id': str(uuid.uuid4()),
                'purpose': row['purpose'],
                'name': row['name'],
                'subject': row['subject'],
                'body': row['body_template'],
                'vars': json.dumps(row['variable_names']),
                'notes': row['notes'],
            },
        )


def downgrade():
    bind = op.get_bind()
    # Remove seeded email rows
    bind.execute(
        sa.text(
            "DELETE FROM notification_templates "
            "WHERE channel = 'email' AND purpose IN "
            "('signup_welcome', 'signup_welcome_pending', 'reset_pw_email')"
        )
    )

    # Restore name-less SMS bodies
    bind.execute(
        sa.text(
            """
            UPDATE notification_templates
               SET body_template = :body,
                   variable_names = CAST(:vars AS JSONB)
             WHERE purpose = 'login_otp' AND channel = 'sms'
            """
        ),
        {
            'body': '{otp} is your OTP to log in to {company_name}. '
                    'Valid for 10 minutes. Do not share it with anyone. - LARAZN',
            'vars': json.dumps(['otp', 'company_name']),
        },
    )
    bind.execute(
        sa.text(
            """
            UPDATE notification_templates
               SET body_template = :body,
                   variable_names = CAST(:vars AS JSONB)
             WHERE purpose = 'reset_pw_otp' AND channel = 'sms'
            """
        ),
        {
            'body': '{otp} is your OTP to reset your password on {company_name}. '
                    'Valid for 10 minutes. Do not share it with anyone. - LARAZN',
            'vars': json.dumps(['otp', 'company_name']),
        },
    )

    # Drop composite unique, restore single-column unique on purpose
    op.drop_constraint(
        'uq_notification_templates_channel_purpose',
        'notification_templates', type_='unique',
    )
    op.drop_index('ix_notification_templates_purpose', table_name='notification_templates')
    op.create_index(
        'ix_notification_templates_purpose',
        'notification_templates', ['purpose'],
        unique=True,
    )

    op.drop_column('notification_templates', 'subject')
