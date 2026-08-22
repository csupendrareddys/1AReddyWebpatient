"""Edit email templates from the command line.

Email templates live in the ``notification_templates`` DB table
(``channel='email'``). There's no admin UI yet — this script is the
"where do I edit emails" answer.

USAGE
-----

List every email template::

    docker exec -it -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/edit_email_template.py list

Show the full body + subject for one purpose::

    docker exec -it -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/edit_email_template.py show signup_welcome_patient

Open the body in $EDITOR (vi / nano), save, exit — the new content is
committed and the Redis cache for that purpose is invalidated::

    docker exec -it -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/edit_email_template.py edit signup_welcome_patient

Update just the subject (one-liner)::

    docker exec -it -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/edit_email_template.py set-subject \
            signup_welcome_patient "Welcome to {company_name}!"

Disable / re-enable a template (stops it from sending without losing
the row)::

    python scripts/edit_email_template.py disable verify_email_otp
    python scripts/edit_email_template.py enable  verify_email_otp


VARIABLES
---------

Bodies and subjects use Python ``str.format`` syntax. Available
variables depend on the trigger that fires the template:

    {first_name}    user's first name (or "there" if missing)
    {company_name}  tenant display name (LARAZEN for platform-context)
    {otp}           one-time code (only OTP / reset templates)
    {timestamp}     human-readable UTC time
    {device}, {location}    login_alert only
    {login_url}             doctor_approved
    {reason}                doctor_rejected
    {accept_url}            staff_invited
    {dashboard_url}         tenant_ready
    {unlock_time}           account_locked

Use the exact variable_names list shown by the ``show`` command — any
key the body references but the trigger doesn't supply will raise at
send time.
"""
import os
import subprocess
import sys
import tempfile

from sqlalchemy import text


def _connect():
    sys.path.insert(0, '/app')
    from app import create_app
    from app.extensions import db
    app = create_app()
    return app, db


def _invalidate_cache(purpose=None):
    try:
        from app.services.email_service import EmailService
        EmailService.invalidate_template_cache(purpose=purpose)
        print(f"  ✓ cache invalidated for purpose={purpose or '(all)'}")
    except Exception as e:
        print(f"  ! cache invalidation skipped: {e}")


def cmd_list():
    app, db = _connect()
    with app.app_context():
        rows = db.session.execute(text(
            "SELECT purpose, name, is_active, "
            "       LENGTH(body_template) AS body_len "
            "FROM notification_templates "
            "WHERE channel='email' "
            "ORDER BY purpose"
        )).all()
        if not rows:
            print("(no email templates seeded)")
            return
        print(f"{'purpose':30s}  {'active':6s}  body  name")
        print("-" * 80)
        for r in rows:
            print(f"{r.purpose:30s}  {str(r.is_active):6s}  {r.body_len:5d}  {r.name}")


def cmd_show(purpose):
    app, db = _connect()
    with app.app_context():
        row = db.session.execute(text(
            "SELECT purpose, name, subject, body_template, variable_names, "
            "       is_active, sender_id "
            "FROM notification_templates "
            "WHERE channel='email' AND purpose=:p"
        ), {'p': purpose}).first()
        if not row:
            print(f"(no email template with purpose={purpose})")
            return
        print(f"purpose:        {row.purpose}")
        print(f"name:           {row.name}")
        print(f"sender:         {row.sender_id}")
        print(f"is_active:      {row.is_active}")
        print(f"variable_names: {row.variable_names}")
        print(f"subject:        {row.subject}")
        print('-' * 60)
        print(row.body_template)


def cmd_edit(purpose):
    app, db = _connect()
    with app.app_context():
        row = db.session.execute(text(
            "SELECT body_template FROM notification_templates "
            "WHERE channel='email' AND purpose=:p"
        ), {'p': purpose}).first()
        if not row:
            print(f"(no email template with purpose={purpose})")
            return

        editor = os.environ.get('EDITOR', 'nano')
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.html', delete=False, encoding='utf-8',
        ) as f:
            f.write(row.body_template)
            path = f.name

        try:
            subprocess.run([editor, path], check=True)
            with open(path, encoding='utf-8') as f:
                new_body = f.read()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

        if new_body == row.body_template:
            print("(no changes)")
            return

        db.session.execute(text(
            "UPDATE notification_templates "
            "SET body_template = :body "
            "WHERE channel='email' AND purpose=:p"
        ), {'body': new_body, 'p': purpose})
        db.session.commit()
        _invalidate_cache(purpose)
        print(f"✓ updated body_template for purpose={purpose}")


def cmd_set_subject(purpose, subject):
    app, db = _connect()
    with app.app_context():
        result = db.session.execute(text(
            "UPDATE notification_templates "
            "SET subject = :subject "
            "WHERE channel='email' AND purpose=:p"
        ), {'subject': subject, 'p': purpose})
        db.session.commit()
        if result.rowcount:
            _invalidate_cache(purpose)
            print(f"✓ subject updated for purpose={purpose}")
        else:
            print(f"(no email template with purpose={purpose})")


def cmd_set_active(purpose, value):
    app, db = _connect()
    with app.app_context():
        result = db.session.execute(text(
            "UPDATE notification_templates "
            "SET is_active = :v "
            "WHERE channel='email' AND purpose=:p"
        ), {'v': value, 'p': purpose})
        db.session.commit()
        if result.rowcount:
            _invalidate_cache(purpose)
            print(f"✓ is_active={value} for purpose={purpose}")
        else:
            print(f"(no email template with purpose={purpose})")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    args = sys.argv[2:]

    if cmd == 'list':
        cmd_list()
    elif cmd == 'show' and args:
        cmd_show(args[0])
    elif cmd == 'edit' and args:
        cmd_edit(args[0])
    elif cmd == 'set-subject' and len(args) >= 2:
        cmd_set_subject(args[0], args[1])
    elif cmd == 'disable' and args:
        cmd_set_active(args[0], False)
    elif cmd == 'enable' and args:
        cmd_set_active(args[0], True)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()
