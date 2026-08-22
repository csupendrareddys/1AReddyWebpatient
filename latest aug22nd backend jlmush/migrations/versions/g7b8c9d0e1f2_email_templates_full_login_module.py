"""Full email-template set for the login module.

Adds the remaining 10 email templates to ``notification_templates`` so every
auth-touchpoint has an email body in the DB. Bodies are HTML; rendered via
Python ``str.format`` with named variables, posted to SendClean's
``/messages/sendMail`` as the ``html`` field.

What this migration does
------------------------
1. Renames the generic ``signup_welcome`` row (seeded in
   ``f6a7b8c9d0e1``) to ``signup_welcome_patient`` so we can add
   role-specific welcome variants alongside it.
2. Inserts 10 new email rows covering: pharmacy welcome, sub-admin
   welcome, doctor approved, doctor rejected, password changed,
   login-from-new-device alert, logout-all, account locked, staff
   invited, tenant workspace ready.

All 13 email rows now in ``notification_templates`` (channel='email'):

* signup_welcome_patient
* signup_welcome_pharmacy
* signup_welcome_sub_admin
* signup_welcome_pending          (doctor — pending approval)
* doctor_approved
* doctor_rejected
* reset_pw_email
* password_changed
* login_alert
* logout_all
* account_locked
* staff_invited
* tenant_ready

Variable rendering
------------------
Each row's ``variable_names`` JSONB column lists the keys ``email_service``
must pass to ``str.format``. Missing keys raise ``KeyError`` at send
time — that's intentional, it surfaces wiring bugs in tests.

Revision ID: g7b8c9d0e1f2
Revises: b8c9d0e1f2a3
Create Date: 2026-04-27
"""
from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op


revision = 'g7b8c9d0e1f2'
down_revision = 'b8c9d0e1f2a3'
branch_labels = None
depends_on = None


# ── Shared HTML scaffold ──────────────────────────────────────────
# Wrap every body in a consistent envelope so the look-and-feel stays
# uniform across all 13 emails. Brand colour #1976d2 (LARAZN blue),
# 600px max width, system Arial fallback (works in every email client).
def _wrap(headline: str, inner_html: str) -> str:
    return (
        '<!DOCTYPE html>\n'
        '<html><body style="font-family:Arial,sans-serif;line-height:1.6;'
        'color:#333;background:#f7f7f7;margin:0;padding:0">\n'
        '<div style="max-width:600px;margin:0 auto;padding:24px;'
        'background:#fff">\n'
        f'  <h2 style="color:#1976d2;margin-top:0">{headline}</h2>\n'
        f'  {inner_html}\n'
        '  <p style="margin-top:30px;color:#888;font-size:12px">'
        '— The {company_name} team · powered by LARAZN</p>\n'
        '</div></body></html>\n'
    )


def _otp_box(var_name: str = 'otp') -> str:
    """Big dashed-border OTP box — used in reset_pw_email."""
    return (
        f'<div style="font-size:32px;font-weight:bold;color:#1976d2;'
        f'letter-spacing:8px;padding:18px;background:#f0f7ff;'
        f'text-align:center;border-radius:8px;margin:20px 0;'
        f'border:2px dashed #1976d2">{{{var_name}}}</div>'
    )


# ── Template definitions ─────────────────────────────────────────
# Each tuple: (purpose, name, subject, html, [variable_names], notes)
NEW_EMAIL_ROWS = [
    # -------- Welcomes --------
    (
        'signup_welcome_pharmacy',
        'Welcome email — pharmacy',
        'Welcome to {company_name}!',
        _wrap(
            'Welcome, {first_name}!',
            '<p>Your pharmacy account on <strong>{company_name}</strong> '
            'is ready.</p>'
            '<p>You can now receive prescriptions from verified doctors, '
            'manage inventory, and track fulfilment in one place.</p>'
            '<p>Login from your dashboard to complete your pharmacy '
            'profile (license number, address, hours).</p>'
        ),
        ['first_name', 'company_name'],
        'Sent immediately after pharmacy signup completes.',
    ),
    (
        'signup_welcome_sub_admin',
        'Welcome email — sub-admin',
        'You\'re now an admin on {company_name}',
        _wrap(
            'Welcome, {first_name}',
            '<p>You\'ve been added as a <strong>sub-admin</strong> on '
            '<strong>{company_name}</strong>.</p>'
            '<p>You can manage clinic operations, invite staff, configure '
            'pricing, and view reports from your admin dashboard.</p>'
            '<p>If you weren\'t expecting this invitation, please contact '
            'the person who invited you before signing in.</p>'
        ),
        ['first_name', 'company_name'],
        'Sent when a sub-admin completes onboarding.',
    ),

    # -------- Doctor approval flow --------
    (
        'doctor_approved',
        'Doctor verification approved',
        'Your {company_name} account is now active',
        _wrap(
            'You\'re verified, Dr. {first_name}!',
            '<p>Good news — your registration with '
            '<strong>{company_name}</strong> has been verified and your '
            'account is now active.</p>'
            '<p>You can now sign in and start accepting consultations.</p>'
            '<p style="margin:24px 0">'
            '<a href="{login_url}" '
            'style="display:inline-block;padding:12px 24px;background:#1976d2;'
            'color:#fff;text-decoration:none;border-radius:6px;'
            'font-weight:bold">Sign in to {company_name}</a>'
            '</p>'
        ),
        ['first_name', 'company_name', 'login_url'],
        'Sent when an admin approves a doctor signup.',
    ),
    (
        'doctor_rejected',
        'Doctor verification not approved',
        'Update on your {company_name} verification',
        _wrap(
            'Verification update — Dr. {first_name}',
            '<p>Thank you for registering with '
            '<strong>{company_name}</strong>.</p>'
            '<p>Unfortunately, after reviewing your submission we are '
            'unable to verify your account at this time.</p>'
            '<p><strong>Reason:</strong> {reason}</p>'
            '<p>If you believe this is a mistake or you can supply '
            'additional documentation, please reply to this email or '
            'contact our support team.</p>'
        ),
        ['first_name', 'company_name', 'reason'],
        'Sent when an admin rejects a doctor signup. {reason} is admin-supplied free text.',
    ),

    # -------- Password & session security --------
    (
        'password_changed',
        'Password changed confirmation',
        'Your {company_name} password was changed',
        _wrap(
            'Password changed',
            '<p>Hi {first_name},</p>'
            '<p>This is a confirmation that the password for your '
            '<strong>{company_name}</strong> account was changed on '
            '<strong>{timestamp}</strong>.</p>'
            '<p>If this was you, no further action is needed.</p>'
            '<p style="background:#fff3cd;padding:12px;border-radius:6px;'
            'border-left:4px solid #ffc107;margin:16px 0">'
            '<strong>Didn\'t change your password?</strong><br>'
            'Reset it immediately and contact support — your account '
            'may be compromised.</p>'
        ),
        ['first_name', 'company_name', 'timestamp'],
        'Sent after a successful password change (not reset). {timestamp} formatted in user TZ.',
    ),
    (
        'login_alert',
        'New device login alert',
        'New sign-in to your {company_name} account',
        _wrap(
            'New sign-in detected',
            '<p>Hi {first_name},</p>'
            '<p>A new sign-in to your <strong>{company_name}</strong> '
            'account was detected:</p>'
            '<ul style="background:#f0f7ff;padding:16px 16px 16px 36px;'
            'border-radius:6px">'
            '<li><strong>Device:</strong> {device}</li>'
            '<li><strong>Location:</strong> {location}</li>'
            '<li><strong>When:</strong> {timestamp}</li>'
            '</ul>'
            '<p>If this was you, no action needed.</p>'
            '<p style="background:#fff3cd;padding:12px;border-radius:6px;'
            'border-left:4px solid #ffc107;margin:16px 0">'
            '<strong>Don\'t recognise this sign-in?</strong><br>'
            'Reset your password and review active sessions in your '
            'security settings immediately.</p>'
        ),
        ['first_name', 'company_name', 'device', 'location', 'timestamp'],
        'Sent when login fingerprint (UA+IP geolocation) differs from prior sessions.',
    ),
    (
        'logout_all',
        'All sessions logged out',
        'All sessions on {company_name} have been signed out',
        _wrap(
            'All sessions ended',
            '<p>Hi {first_name},</p>'
            '<p>All active sessions on your <strong>{company_name}</strong> '
            'account were signed out on <strong>{timestamp}</strong>.</p>'
            '<p>This usually happens because you triggered "Sign out '
            'everywhere" from your security settings, or because we '
            'detected suspicious activity.</p>'
            '<p>You\'ll need to sign in again on each of your devices.</p>'
        ),
        ['first_name', 'company_name', 'timestamp'],
        'Sent after a global session revoke (user-triggered or automated).',
    ),
    (
        'account_locked',
        'Account temporarily locked',
        'Your {company_name} account is temporarily locked',
        _wrap(
            'Account locked',
            '<p>Hi {first_name},</p>'
            '<p>Your <strong>{company_name}</strong> account has been '
            'temporarily locked because of multiple failed sign-in '
            'attempts.</p>'
            '<p>You\'ll be able to sign in again automatically '
            '<strong>at {unlock_time}</strong>. If you need access '
            'sooner, reset your password — that unlocks the account '
            'immediately.</p>'
            '<p style="background:#fff3cd;padding:12px;border-radius:6px;'
            'border-left:4px solid #ffc107;margin:16px 0">'
            'If you weren\'t the one trying to sign in, reset your '
            'password right away — someone may be trying to '
            'access your account.</p>'
        ),
        ['first_name', 'company_name', 'unlock_time'],
        'Sent after 5 failed login attempts. {unlock_time} is when the lockout expires.',
    ),

    # -------- Onboarding & invitations --------
    (
        'staff_invited',
        'Staff invitation',
        '{inviter_name} invited you to {company_name}',
        _wrap(
            'You\'re invited to {company_name}',
            '<p>Hi {first_name},</p>'
            '<p><strong>{inviter_name}</strong> has invited you to join '
            '<strong>{company_name}</strong> as a staff member.</p>'
            '<p>Click below to accept the invitation and set up your '
            'account. The link expires in 7 days.</p>'
            '<p style="margin:24px 0">'
            '<a href="{accept_url}" '
            'style="display:inline-block;padding:12px 24px;background:#1976d2;'
            'color:#fff;text-decoration:none;border-radius:6px;'
            'font-weight:bold">Accept invitation</a>'
            '</p>'
            '<p style="color:#888;font-size:12px">If you weren\'t expecting '
            'this invitation, you can safely ignore this email.</p>'
        ),
        ['first_name', 'company_name', 'inviter_name', 'accept_url'],
        'Sent to invited staff. {accept_url} embeds a one-shot signed token.',
    ),
    (
        'tenant_ready',
        'Tenant workspace ready',
        'Your {company_name} workspace is live',
        _wrap(
            'Your workspace is ready, {first_name}!',
            '<p>Your <strong>{company_name}</strong> workspace has been '
            'provisioned and is ready to use.</p>'
            '<p>Next steps:</p>'
            '<ol>'
            '<li>Configure your clinic profile (logo, address, hours)</li>'
            '<li>Invite your team — doctors, pharmacy staff, admins</li>'
            '<li>Set your consultation pricing</li>'
            '<li>Start accepting bookings</li>'
            '</ol>'
            '<p style="margin:24px 0">'
            '<a href="{dashboard_url}" '
            'style="display:inline-block;padding:12px 24px;background:#1976d2;'
            'color:#fff;text-decoration:none;border-radius:6px;'
            'font-weight:bold">Open your dashboard</a>'
            '</p>'
        ),
        ['first_name', 'company_name', 'dashboard_url'],
        'Sent to the tenant owner once Cloudflare DNS + RLS bootstrap completes.',
    ),
]


def upgrade():
    bind = op.get_bind()

    # 1. Rename the generic patient welcome to its role-specific key.
    bind.execute(
        sa.text(
            "UPDATE notification_templates "
            "   SET purpose = 'signup_welcome_patient' "
            " WHERE purpose = 'signup_welcome' AND channel = 'email'"
        )
    )

    # 2. Seed the 10 new email rows.
    insert_sql = sa.text(
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
    )
    for purpose, name, subject, body, var_names, notes in NEW_EMAIL_ROWS:
        bind.execute(
            insert_sql,
            {
                'id': str(uuid.uuid4()),
                'purpose': purpose,
                'name': name,
                'subject': subject,
                'body': body,
                'vars': json.dumps(var_names),
                'notes': notes,
            },
        )


def downgrade():
    bind = op.get_bind()

    # Remove the 10 newly seeded rows.
    purposes = [r[0] for r in NEW_EMAIL_ROWS]
    bind.execute(
        sa.text(
            "DELETE FROM notification_templates "
            " WHERE channel = 'email' AND purpose = ANY(:purposes)"
        ).bindparams(sa.bindparam('purposes', value=purposes, expanding=True))
    )

    # Restore the generic key.
    bind.execute(
        sa.text(
            "UPDATE notification_templates "
            "   SET purpose = 'signup_welcome' "
            " WHERE purpose = 'signup_welcome_patient' AND channel = 'email'"
        )
    )
