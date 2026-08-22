"""SMS template registry — fill with VI DLT-approved bodies + template IDs.

What this migration does
------------------------
1. UPDATEs the 4 OTP-flow SMS rows (login_otp, signup_otp, reset_pw_otp,
   verify_phone_otp) so the body matches the *exact* wording approved by
   Vodafone Idea DLT, and fills in the corresponding ``template_id`` so
   ``SMSService`` will actually dispatch instead of raising
   "SMS template not yet approved by carrier."
2. INSERTs 6 new SMS rows for the additional auth/admin touchpoints we
   wired email triggers for: ``logout_all``, ``login_alert``,
   ``doctor_approved``, ``doctor_rejected``, ``staff_invited``,
   ``tenant_ready``. Each ships with its DLT template ID.

Wording rules learned from the DLT review cycle
-----------------------------------------------
* OTP templates (Transactional) must use as few variables as possible.
  Reviewers reject 3-variable OTPs ("reduct variable / required
  Justification"). The approvable shapes are:
    - 1 var: ``Your OTP for X is {otp}.`` (no name, no company)
    - 2 var: ``Hi {first_name}. {otp} is your X for LARAZEN.``
              (LARAZEN hardcoded — no company variable)
    - 3 var: ONLY for reset_pw_otp_v4 which DID slip through with
      ``{first_name}/{otp}/{company_name}``; we keep that wording verbatim.
* Notification templates (Service-Implicit) accept up to 2 alphanumeric
  vars (first_name + company_name) — pattern matches logout_all_v4.
* Footer brand says ``- LARAZEN`` (intentionally different from the
  ``LARAZN`` sender header — LARAZEN is the brand mention, LARAZN is
  the registered DLT header). Don't normalise these.

Revision ID: h8c9d0e1f2a3
Revises: d0e1f2a3b4c5
Create Date: 2026-04-30

Note on parentage: originally chained off ``g7b8c9d0e1f2`` (added on a
parallel branch alongside the recognitions/videos/doctors-reviews-brands
chain). Re-parented to descend from ``d0e1f2a3b4c5`` so the alembic tree
stays linear — required because the public-booking migration
``e2f3a4b5c6d7`` then chains off this one and the CI roundtrip step
uses ``flask db downgrade -1`` which can't walk a merge migration
(raises "Ambiguous walk"). The SQL here only touches
``notification_templates`` rows, which exist by ``e5f6a7b8c9d0`` — well
before the new effective parent — so the re-parent is safe.
"""
from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op


revision = 'h8c9d0e1f2a3'
down_revision = 'd0e1f2a3b4c5'
branch_labels = None
depends_on = None


# ── Approved OTP rows (UPDATE existing) ─────────────────────────────
# These purposes already exist as SMS rows from migration e5f6a7b8c9d0;
# we rewrite the body + variable list + template_id to match the
# DLT-approved wording exactly.
SMS_UPDATES = [
    {
        'purpose': 'login_otp',
        'template_id': '1107177736438857609',
        'body': (
            'Your OTP for login is {otp}. It is valid for 10 minutes. '
            'Do not share this OTP with anyone. - LARAZEN'
        ),
        'variable_names': ['otp'],
        'notes': 'DLT-approved 28-04-2026 (larazn_login_otp_v5). '
                 'Single-variable form — first_name and company_name '
                 'are NOT available in this template.',
    },
    {
        'purpose': 'signup_otp',
        'template_id': '1107900001325600003',
        'body': (
            'Hi {first_name}. {otp} is your signup OTP for LARAZEN. '
            "Valid for 10min. Don't share it with anyone for security reasons. "
            '- LARAZEN'
        ),
        'variable_names': ['first_name', 'otp'],
        'notes': 'DLT-approved 30-04-2026 (larazn_signup_otp_v4). '
                 'LARAZEN brand is hardcoded — no {company_name} variable.',
    },
    {
        'purpose': 'reset_pw_otp',
        'template_id': '1107900001325600004',
        'body': (
            'Hi {first_name}. {otp} is your reset OTP for {company_name}. '
            "Valid 10min. Don't share. - LARAZEN"
        ),
        'variable_names': ['first_name', 'otp', 'company_name'],
        'notes': 'DLT-approved 30-04-2026 (larazn_reset_pw_otp_v4). '
                 'Only OTP template that retains {company_name}.',
    },
    {
        'purpose': 'verify_phone_otp',
        'template_id': '1107900001325600005',
        'body': (
            'Hi {first_name}. {otp} is your phone OTP for LARAZEN. '
            "Valid for 10min. Don't share it with anyone for security reason. "
            '- LARAZEN'
        ),
        'variable_names': ['first_name', 'otp'],
        'notes': 'DLT-approved 28-04-2026 (larazn_verify_phone_otp_v4). '
                 'LARAZEN brand is hardcoded — no {company_name} variable.',
    },
]


# ── New SMS notification rows (INSERT) ──────────────────────────────
# Service-Implicit category, 2 alphanumeric vars (first_name + company_name).
SMS_INSERTS = [
    {
        'purpose': 'logout_all',
        'name': 'All sessions logged out (SMS)',
        'template_id': '1107900001325600013',
        'body': (
            'Hi {first_name}. All sessions on {company_name} have been '
            'logged out. - LARAZEN'
        ),
        'variable_names': ['first_name', 'company_name'],
        'notes': 'DLT-approved (larazn_logout_all_v4). Mirrors logout_all '
                 'email — fired together after global session revoke.',
    },
    {
        'purpose': 'login_alert',
        'name': 'New device login alert (SMS)',
        'template_id': '1107900001325600008',
        'body': (
            'Hi {first_name}. New login on {company_name}. Not you? '
            'Reset password. - LARAZEN'
        ),
        'variable_names': ['first_name', 'company_name'],
        'notes': 'DLT-approved (larazn_login_alert_v4). SMS version is '
                 'compact — full device/location/timestamp lives in the '
                 'companion email only.',
    },
    {
        'purpose': 'doctor_approved',
        'name': 'Doctor verification approved (SMS)',
        'template_id': '1107900001325600009',
        'body': (
            'Hi Dr. {first_name}. Your {company_name} account is verified '
            'and active. Login now. - LARAZEN'
        ),
        'variable_names': ['first_name', 'company_name'],
        'notes': 'DLT-approved (larazn_doctor_approved_v4). "Hi Dr." '
                 'prefix is part of the approved wording — keep it verbatim.',
    },
    {
        'purpose': 'doctor_rejected',
        'name': 'Doctor verification rejected (SMS)',
        'template_id': '1107900001325600010',
        'body': (
            'Hi Dr. {first_name}. Your {company_name} verification was '
            'not approved. Contact admin. - LARAZEN'
        ),
        'variable_names': ['first_name', 'company_name'],
        'notes': 'DLT-approved (larazn_doctor_rejected_v4). Reason text '
                 'lives in the companion email only — SMS body is fixed.',
    },
    {
        'purpose': 'staff_invited',
        'name': 'Staff invitation (SMS)',
        'template_id': '1107900001325600011',
        'body': (
            "Hi {first_name}. You've been added as staff at "
            '{company_name}. Check email for login. - LARAZEN'
        ),
        'variable_names': ['first_name', 'company_name'],
        'notes': 'DLT-approved (larazn_staff_invited_v4). Accept-link URL '
                 'is too long for SMS — sent in the companion email.',
    },
    {
        'purpose': 'tenant_ready',
        'name': 'Tenant workspace ready (SMS)',
        'template_id': '1107900001325600012',
        'body': (
            'Hi {first_name}. Your {company_name} workspace is live. '
            'Login to set up your team. - LARAZEN'
        ),
        'variable_names': ['first_name', 'company_name'],
        'notes': 'DLT-approved (larazn_tenant_ready_v4). Sent to the '
                 'first super_admin after Cloudflare DNS provisioning.',
    },
]


def upgrade():
    bind = op.get_bind()

    # 1. Update the 4 OTP rows.
    update_sql = sa.text(
        """
        UPDATE notification_templates
           SET template_id    = :template_id,
               body_template  = :body,
               variable_names = CAST(:vars AS JSONB),
               sender_id      = 'LARAZN',
               notes          = :notes
         WHERE purpose = :purpose AND channel = 'sms'
        """
    )
    for row in SMS_UPDATES:
        bind.execute(
            update_sql,
            {
                'purpose': row['purpose'],
                'template_id': row['template_id'],
                'body': row['body'],
                'vars': json.dumps(row['variable_names']),
                'notes': row['notes'],
            },
        )

    # 2. Insert the 6 new notification rows.
    insert_sql = sa.text(
        """
        INSERT INTO notification_templates
            (id, purpose, name, channel, template_id, sender_id,
             subject, body_template, variable_names,
             is_active, notes)
        VALUES
            (:id, :purpose, :name, 'sms', :template_id, 'LARAZN',
             NULL, :body, CAST(:vars AS JSONB),
             TRUE, :notes)
        """
    )
    for row in SMS_INSERTS:
        bind.execute(
            insert_sql,
            {
                'id': str(uuid.uuid4()),
                'purpose': row['purpose'],
                'name': row['name'],
                'template_id': row['template_id'],
                'body': row['body'],
                'vars': json.dumps(row['variable_names']),
                'notes': row['notes'],
            },
        )


def downgrade():
    bind = op.get_bind()

    # Delete the 6 new SMS rows.
    purposes = [r['purpose'] for r in SMS_INSERTS]
    bind.execute(
        sa.text(
            "DELETE FROM notification_templates "
            " WHERE channel = 'sms' AND purpose = ANY(:purposes)"
        ).bindparams(sa.bindparam('purposes', value=purposes, expanding=True))
    )

    # Restore the 4 OTP rows to their pre-h8c9d0e1f2a3 state. We don't
    # know the exact prior bodies (could be e5f6a7b8c9d0 or
    # f6a7b8c9d0e1 wording depending on history), so we wipe template_id
    # so SMSService raises "not yet approved" — safer than an outdated body.
    bind.execute(
        sa.text(
            """
            UPDATE notification_templates
               SET template_id = NULL,
                   notes = 'Reverted by h8c9d0e1f2a3 downgrade — '
                           're-run upgrade or refill template_id manually.'
             WHERE channel = 'sms'
               AND purpose IN ('login_otp', 'signup_otp',
                               'reset_pw_otp', 'verify_phone_otp')
            """
        )
    )
