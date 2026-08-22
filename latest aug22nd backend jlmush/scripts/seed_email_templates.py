"""Seed the EMAIL notification-template registry from the migrations.

Why this exists: ``scripts/migrate.py`` bootstraps fresh databases via
``db.create_all()`` + ``stamp head`` — which builds the SCHEMA but skips
every migration's DATA seed. Any create_all-born DB (local dev, the
harness DB, and a greenfield prod under ENVIRONMENT_DESIGN Phase 3
Option A) therefore has an EMPTY template registry, and every email send
dies with "template missing" (now visible as outbox dead-letters).

The migrations stay the single source of truth: this script IMPORTS
their seed constants (f6a7's ``EMAIL_SEED_ROWS`` dicts + g7b8's
``NEW_EMAIL_ROWS`` tuples) rather than duplicating bodies, applies
g7b8's rename (``signup_welcome`` → ``signup_welcome_patient``), and
upserts with ON CONFLICT DO NOTHING so operator-edited rows are never
clobbered. Idempotent; safe to re-run any time.

The SMS sibling is scripts/seed_sms_templates.py (already existed);
verify_email_otp has scripts/seed_verify_email_template.py. Run all
three on any fresh database:

    docker exec -w /app -e PYTHONPATH=/app jlmush-backend \\
        python scripts/seed_email_templates.py
"""
import importlib.util
import pathlib
import uuid

from app import create_app

_MIGRATIONS = pathlib.Path(__file__).resolve().parents[1] / 'migrations' / 'versions'


def _load(module_filename):
    path = _MIGRATIONS / module_filename
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    f6a7 = _load('f6a7b8c9d0e1_email_templates_personalization.py')
    g7b8 = _load('g7b8c9d0e1f2_email_templates_full_login_module.py')

    rows = []
    for r in f6a7.EMAIL_SEED_ROWS:
        purpose = r['purpose']
        # g7b8 renamed the generic welcome to its role-specific name.
        if purpose == 'signup_welcome':
            purpose = 'signup_welcome_patient'
        rows.append({
            'purpose': purpose,
            'name': r['name'],
            'subject': r['subject'],
            'body_template': r['body_template'],
            'variable_names': r['variable_names'],
            'notes': r.get('notes'),
        })
    for purpose, name, subject, html, var_names, notes in g7b8.NEW_EMAIL_ROWS:
        rows.append({
            'purpose': purpose,
            'name': name,
            'subject': subject,
            'body_template': html,
            'variable_names': var_names,
            'notes': notes,
        })

    app = create_app()
    with app.app_context():
        import json

        from sqlalchemy import text

        from app.extensions import db

        inserted = skipped = 0
        for r in rows:
            res = db.session.execute(text("""
                INSERT INTO notification_templates
                    (id, purpose, name, channel, template_id, sender_id,
                     subject, body_template, variable_names, is_active,
                     notes, created_at, updated_at)
                VALUES
                    (:id, :purpose, :name, 'email', NULL, 'LARAZN',
                     :subject, :body, CAST(:vars AS jsonb), true,
                     :notes, now(), now())
                ON CONFLICT (channel, purpose) DO NOTHING
            """), {
                'id': str(uuid.uuid4()),
                'purpose': r['purpose'],
                'name': r['name'],
                'subject': r['subject'],
                'body': r['body_template'],
                'vars': json.dumps(r['variable_names']),
                'notes': r['notes'],
            })
            if res.rowcount:
                inserted += 1
                print(f"  + {r['purpose']}", flush=True)
            else:
                skipped += 1
        db.session.commit()
        total = db.session.execute(text(
            "SELECT COUNT(*) FROM notification_templates "
            "WHERE channel='email' AND is_active")).scalar()
        print(f'\nDone: {inserted} inserted, {skipped} already present; '
              f'{total} active email templates now.', flush=True)


if __name__ == '__main__':
    main()
