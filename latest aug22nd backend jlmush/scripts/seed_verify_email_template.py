"""One-shot seeder for the ``verify_email_otp`` email template.

Run this on environments where ``j0e1f2a3b4c5`` was stamped past
without executing (the ``db.create_all() + flask db stamp head``
bootstrap path skips data migrations). Idempotent — safe to re-run.

Usage::

    docker exec -i -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/seed_verify_email_template.py
"""
import json
import uuid

from sqlalchemy import text


SUBJECT = 'Verify your {company_name} email — code: {otp}'

HTML = """\
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f7f7f7;margin:0;padding:0">
<div style="max-width:600px;margin:0 auto;padding:24px;background:#fff">
  <h2 style="color:#1976d2;margin-top:0">Verify your email</h2>
  <p>Hi {first_name},</p>
  <p>Use the code below to verify this email address on
  <strong>{company_name}</strong>:</p>
  <div style="font-size:32px;font-weight:bold;color:#1976d2;
              letter-spacing:8px;padding:18px;background:#f0f7ff;
              text-align:center;border-radius:8px;margin:20px 0;
              border:2px dashed #1976d2">{otp}</div>
  <p>This code is valid for 10 minutes. Once verified you'll be able
  to sign in with email and reset your password by email.</p>
  <p style="background:#fff3cd;padding:12px;border-radius:6px;
            border-left:4px solid #ffc107;margin:16px 0">
    <strong>Didn't request this?</strong><br>
    Someone may have signed up with your email address by mistake.
    You can safely ignore this email — no further messages will be
    sent and the account will remain unable to use email login or
    email-based password reset until verified.
  </p>
  <p style="margin-top:30px;color:#888;font-size:12px">
    — The {company_name} team · powered by LARAZEN
  </p>
</div></body></html>
"""


def main():
    from app import create_app
    from app.extensions import db

    app = create_app()
    with app.app_context():
        # Defensive INSERT ... WHERE NOT EXISTS — works on environments
        # where the (channel, purpose) unique constraint hasn't been
        # created yet (db.create_all bootstrap path).
        result = db.session.execute(
            text(
                """
                INSERT INTO notification_templates
                    (id, purpose, name, channel, template_id, sender_id,
                     subject, body_template, variable_names,
                     is_active, notes, created_at, updated_at)
                SELECT :id, 'verify_email_otp', 'Email verification OTP',
                       'email', NULL, 'LARAZEN',
                       :subject, :body, CAST(:vars AS JSONB),
                       TRUE, 'Seeded by scripts/seed_verify_email_template.py',
                       NOW(), NOW()
                WHERE NOT EXISTS (
                    SELECT 1 FROM notification_templates
                     WHERE channel='email' AND purpose='verify_email_otp'
                )
                """
            ),
            {
                'id': str(uuid.uuid4()),
                'subject': SUBJECT,
                'body': HTML,
                'vars': json.dumps(['first_name', 'otp', 'company_name']),
            },
        )
        db.session.commit()
        verb = 'INSERTED' if result.rowcount else 'ALREADY EXISTS'
        print(f"verify_email_otp: {verb}")


if __name__ == '__main__':
    main()
