"""Seed the ``verify_email_otp`` email template.

Why
---
Closes the unverified-email security hole. After signup we now keep
``email_verified=False`` until the user enters a 6-digit OTP that
arrives at the address they typed. This template renders that OTP
email; ``EmailService.send_email_verification_otp`` calls it.

Body uses the same visual envelope as the other ``g7b8c9d0e1f2`` email
rows — LARAZEN blue, 600px max width, dashed-border OTP box.

Idempotent: ``ON CONFLICT (channel, purpose) DO NOTHING`` so re-running
this on an environment where the row was already inserted manually is
a no-op.

Revision ID: j0e1f2a3b4c5
Revises: i9d0e1f2a3b4
Create Date: 2026-04-30
"""
from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op


revision = 'j0e1f2a3b4c5'
down_revision = 'i9d0e1f2a3b4'
branch_labels = None
depends_on = None


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


def upgrade():
    # Defensive INSERT ... WHERE NOT EXISTS instead of ON CONFLICT —
    # works whether or not the (channel, purpose) unique constraint
    # has been created yet. The CI roundtrip stage bootstraps via
    # ``db.create_all() + stamp head`` so the alembic-only constraint
    # from f6a7b8c9d0e1 may be absent on the test DB.
    # ``created_at`` / ``updated_at`` are populated via NOW() because
    # the table created via ``db.create_all()`` (from TimestampMixin)
    # lacks a server_default — the Python ``default=utcnow`` only fires
    # for ORM ``session.add()``, not raw SQL inserts.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO notification_templates
                (id, purpose, name, channel, template_id, sender_id,
                 subject, body_template, variable_names,
                 is_active, notes, created_at, updated_at)
            SELECT :id, 'verify_email_otp', 'Email verification OTP',
                   'email', NULL, 'LARAZEN',
                   :subject, :body, CAST(:vars AS JSONB),
                   TRUE, :notes, NOW(), NOW()
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
            'notes': (
                'Sent from /auth/email/send-verification. 10-min TTL on '
                'OTP stored in Redis under email_verify_otp:<user_id>.'
            ),
        },
    )


def downgrade():
    op.execute(
        "DELETE FROM notification_templates "
        "WHERE channel='email' AND purpose='verify_email_otp'"
    )
