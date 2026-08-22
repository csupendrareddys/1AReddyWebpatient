"""One-shot SMS-template seeder for environments where alembic was
stamped past h8c9d0e1f2a3 without actually running its upgrade body.

Symptom that brings you here
----------------------------
* ``flask db current`` reports a revision >= h8c9d0e1f2a3
* ``notification_templates`` rows exist but ``template_id`` is NULL on
  the OTP rows, AND the 6 notification rows (logout_all, login_alert,
  doctor_approved/rejected, staff_invited, tenant_ready) are missing
  entirely.

Cause: bootstrap path used ``db.create_all() + flask db stamp head``,
which builds the schema from SQLAlchemy models but skips every
data-altering migration. Seed migrations (which only run SQL UPDATEs
and INSERTs) never execute under that flow.

This script is idempotent — running it twice is a no-op:
* OTP rows: UPDATE (only sets template_id + body if currently NULL/empty)
* Notification rows: INSERT ON CONFLICT DO NOTHING via uniqueness on
  (channel, purpose).

Run it once inside the backend container::

    docker exec -it jlmush-backend python scripts/seed_sms_templates.py

After it prints "DONE", flush the Redis SMS cache so the backend stops
serving the stale ``template_id=None`` rows::

    docker exec -it jlmush-redis sh -c \
      "redis-cli --scan --pattern 'sms_template:*' | xargs -r redis-cli del"

Or just bounce the backend container.
"""
import json
import sys
import uuid

from sqlalchemy import text


# ── Same data as migrations/versions/h8c9d0e1f2a3_*.py ─────────────
SMS_UPDATES = [
    {
        'purpose': 'login_otp',
        'template_id': '1107177736438857609',
        'body': (
            'Your OTP for login is {otp}. It is valid for 10 minutes. '
            'Do not share this OTP with anyone. - LARAZEN'
        ),
        'variable_names': ['otp'],
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
    },
    {
        'purpose': 'reset_pw_otp',
        'template_id': '1107900001325600004',
        'body': (
            'Hi {first_name}. {otp} is your reset OTP for {company_name}. '
            "Valid 10min. Don't share. - LARAZEN"
        ),
        'variable_names': ['first_name', 'otp', 'company_name'],
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
    },
]

SMS_INSERTS = [
    {
        'purpose': 'logout_all',
        'name': 'All sessions logged out (SMS)',
        'template_id': '1107900001325600013',
        'body': 'Hi {first_name}. All sessions on {company_name} have been logged out. - LARAZEN',
        'variable_names': ['first_name', 'company_name'],
    },
    {
        'purpose': 'login_alert',
        'name': 'New device login alert (SMS)',
        'template_id': '1107900001325600008',
        'body': 'Hi {first_name}. New login on {company_name}. Not you? Reset password. - LARAZEN',
        'variable_names': ['first_name', 'company_name'],
    },
    {
        'purpose': 'doctor_approved',
        'name': 'Doctor verification approved (SMS)',
        'template_id': '1107900001325600009',
        'body': 'Hi Dr. {first_name}. Your {company_name} account is verified and active. Login now. - LARAZEN',
        'variable_names': ['first_name', 'company_name'],
    },
    {
        'purpose': 'doctor_rejected',
        'name': 'Doctor verification rejected (SMS)',
        'template_id': '1107900001325600010',
        'body': 'Hi Dr. {first_name}. Your {company_name} verification was not approved. Contact admin. - LARAZEN',
        'variable_names': ['first_name', 'company_name'],
    },
    {
        'purpose': 'staff_invited',
        'name': 'Staff invitation (SMS)',
        'template_id': '1107900001325600011',
        'body': "Hi {first_name}. You've been added as staff at {company_name}. Check email for login. - LARAZEN",
        'variable_names': ['first_name', 'company_name'],
    },
    {
        'purpose': 'tenant_ready',
        'name': 'Tenant workspace ready (SMS)',
        'template_id': '1107900001325600012',
        'body': 'Hi {first_name}. Your {company_name} workspace is live. Login to set up your team. - LARAZEN',
        'variable_names': ['first_name', 'company_name'],
    },
]


def main():
    from app import create_app
    from app.extensions import db

    app = create_app()
    with app.app_context():
        # ── 1. UPSERT the 4 OTP rows ─────────────────────────────
        # UPDATE-only assumed migration e5f6 had created them — false
        # on any create_all-bootstrapped DB (rowcount=0, silently
        # missing, every OTP SMS then dies with "template missing").
        # Insert-when-absent first, then the UPDATE stamps DLT ids and
        # bodies either way.
        insert_otp_sql = text(
            """
            INSERT INTO notification_templates
                (id, purpose, name, channel, template_id, sender_id,
                 subject, body_template, variable_names,
                 is_active, notes, created_at, updated_at)
            SELECT :id, :purpose, :name, 'sms', :template_id, 'LARAZN',
                   NULL, :body, CAST(:vars AS JSONB),
                   TRUE, 'Seeded by scripts/seed_sms_templates.py',
                   NOW(), NOW()
            WHERE NOT EXISTS (
                SELECT 1 FROM notification_templates
                 WHERE channel='sms' AND purpose=:purpose
            )
            """
        )
        update_sql = text(
            """
            UPDATE notification_templates
               SET template_id    = :template_id,
                   body_template  = :body,
                   variable_names = CAST(:vars AS JSONB),
                   sender_id      = 'LARAZN'
             WHERE purpose = :purpose AND channel = 'sms'
            """
        )
        for row in SMS_UPDATES:
            params = {
                'purpose': row['purpose'],
                'template_id': row['template_id'],
                'body': row['body'],
                'vars': json.dumps(row['variable_names']),
            }
            created = db.session.execute(insert_otp_sql, {
                **params,
                'id': str(uuid.uuid4()),
                'name': f"SMS OTP — {row['purpose']}",
            }).rowcount
            result = db.session.execute(update_sql, params)
            print(f"  {'INSERT' if created else 'UPDATE'} sms.{row['purpose']:20s} "
                  f"→ tid={row['template_id']} (rowcount={result.rowcount})")

        # ── 2. INSERT the 6 new rows (idempotent via WHERE NOT EXISTS) ─
        # Defensive form — works whether or not the (channel, purpose)
        # unique constraint exists on the target DB.
        insert_sql = text(
            """
            INSERT INTO notification_templates
                (id, purpose, name, channel, template_id, sender_id,
                 subject, body_template, variable_names,
                 is_active, notes, created_at, updated_at)
            SELECT :id, :purpose, :name, 'sms', :template_id, 'LARAZN',
                   NULL, :body, CAST(:vars AS JSONB),
                   TRUE, 'Seeded by scripts/seed_sms_templates.py',
                   NOW(), NOW()
            WHERE NOT EXISTS (
                SELECT 1 FROM notification_templates
                 WHERE channel='sms' AND purpose=:purpose
            )
            """
        )
        for row in SMS_INSERTS:
            result = db.session.execute(
                insert_sql,
                {
                    'id': str(uuid.uuid4()),
                    'purpose': row['purpose'],
                    'name': row['name'],
                    'template_id': row['template_id'],
                    'body': row['body'],
                    'vars': json.dumps(row['variable_names']),
                },
            )
            verb = 'INSERT' if result.rowcount else 'SKIP  '
            print(f"  {verb} sms.{row['purpose']:20s} → tid={row['template_id']}")

        db.session.commit()
        print('\n✓ DONE — flush sms_template:* keys in Redis or restart backend.')


if __name__ == '__main__':
    sys.exit(main() or 0)
