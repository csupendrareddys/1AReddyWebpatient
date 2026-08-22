"""
Platform-Owner Seeder Script
============================

Creates a PLATFORM_OWNER user — the top-of-the-stack account that owns
every tenant and allocates which landing-page modules each tenant's
SUPER_ADMIN is allowed to configure.

There is no public sign-up for this role — that is intentional. A
platform owner is created only by a human with shell access to the
backend container or the database host.

Usage (inside the backend container)::

    # Non-interactive (headless, script-friendly):
    docker exec jlmush-backend python create_platform_owner.py \
        --phone 9876500000 \
        --password 'Test@1234' \
        --email owner@example.com \
        --first-name Owner \
        --last-name Platform

    # Interactive (prompts for each field):
    docker exec -it jlmush-backend python create_platform_owner.py

The script is idempotent: if a user already exists with the given phone
or email, it is promoted to PLATFORM_OWNER (role flipped) and its
password is reset to the value passed on the command line. This lets
you re-run the script to recover a forgotten password without creating
a duplicate.
"""
import argparse
import getpass
import os
import re
import sys


# Add parent directory to path for imports (works when invoked via
# ``docker exec`` with WORKDIR=/app).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _validate_phone(phone):
    """Indian 10-digit number starting with 6-9 (matches the signup schema)."""
    clean = re.sub(r'[\s\-]', '', phone or '')
    if clean.startswith('+91'):
        clean = clean[3:]
    elif clean.startswith('91') and len(clean) == 12:
        clean = clean[2:]
    if not re.match(r'^[6-9]\d{9}$', clean):
        raise ValueError(
            'Phone must be a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.'
        )
    return clean


def _validate_password(password):
    """Same rules the signup schema enforces."""
    if len(password or '') < 8:
        raise ValueError('Password must be at least 8 characters long.')
    if len(password) > 128:
        raise ValueError('Password must not exceed 128 characters.')
    if not re.search(r'[A-Z]', password):
        raise ValueError('Password must contain at least one uppercase letter.')
    if not re.search(r'[a-z]', password):
        raise ValueError('Password must contain at least one lowercase letter.')
    if not re.search(r'[0-9]', password):
        raise ValueError('Password must contain at least one digit.')
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        raise ValueError('Password must contain at least one special character.')


def _validate_email(email):
    if email and '@' not in email:
        raise ValueError('Email does not look valid.')


def create_platform_owner(phone, password, email=None, first_name='Platform',
                          last_name='Owner'):
    """Create (or promote) a user to PLATFORM_OWNER.

    Returns True on success, False otherwise. Prints progress with plain
    ASCII markers so output stays readable in any terminal.
    """
    # Import inside the function so failures surface after argparse has
    # produced --help text, etc.
    from app import create_app
    from app.extensions import db
    from app.models import User, UserRole, UserStatus, Tenant
    from app.common.encryption import hash_for_search

    app = create_app()
    with app.app_context():
        tenant = Tenant.query.filter_by(is_default=True).first()
        if not tenant:
            print("[ERR] No default tenant found. Bootstrap the DB first "
                  "(see TENANT_ARCHITECTURE.md sec 6.1).")
            return False

        # Idempotency: reuse an existing user if phone or email matches.
        phone_hash = hash_for_search(phone)
        user = User.query.filter_by(_phone_hash=phone_hash, is_deleted=False).first()
        if not user and email:
            email_hash = hash_for_search(email)
            user = User.query.filter_by(_email_hash=email_hash, is_deleted=False).first()

        if user:
            print(f"[INFO] User already exists (id={user.id}, role={user.role.value}). "
                  "Promoting to PLATFORM_OWNER and resetting password.")
            user.role = UserRole.PLATFORM_OWNER
            user.status = UserStatus.ACTIVE
            user.first_name = first_name
            user.last_name = last_name
            user.set_password(password)
            if email:
                user.email = email
                user.email_verified = True
            promoted = True
        else:
            user = User(
                first_name=first_name,
                last_name=last_name,
                role=UserRole.PLATFORM_OWNER,
                status=UserStatus.ACTIVE,
                tenant_id=tenant.id,   # Owner is administratively anchored
                                       # to the platform tenant; they can act
                                       # across every tenant via ?tenant_id=.
            )
            user.phone_number = phone
            if email:
                user.email = email
                user.email_verified = True
            user.set_password(password)
            db.session.add(user)
            promoted = False

        db.session.commit()

        print()
        print("=" * 52)
        print(" PLATFORM_OWNER " + ("promoted" if promoted else "created"))
        print("=" * 52)
        print(f"  user_id : {user.id}")
        print(f"  phone   : {phone}")
        if email:
            print(f"  email   : {email}")
        print(f"  tenant  : {tenant.slug} ({tenant.id})")
        print()
        print("Sign in at /auth/admin/login — the dashboard will show")
        print("new 'Tenants' and 'Landing Page' entries.")
        print("=" * 52)
        return True


def _prompt(label, default=None, secret=False):
    reader = getpass.getpass if secret else input
    suffix = f' [{default}]' if default else ''
    value = reader(f"{label}{suffix}: ").strip()
    return value or default or ''


def _run_interactive():
    print()
    print("Platform Owner Creation Wizard")
    print("-" * 32)
    first_name = _prompt("First name", default="Platform")
    last_name = _prompt("Last name", default="Owner")
    phone = _prompt("Phone (10-digit Indian, starts 6-9)")
    email = _prompt("Email (optional, enter to skip)") or None
    password = _prompt("Password", secret=True)
    confirm = _prompt("Confirm password", secret=True)

    if password != confirm:
        print("[ERR] Passwords do not match.")
        sys.exit(1)
    try:
        phone = _validate_phone(phone)
        _validate_password(password)
        _validate_email(email)
    except ValueError as exc:
        print(f"[ERR] {exc}")
        sys.exit(1)

    ok = create_platform_owner(phone, password, email, first_name, last_name)
    sys.exit(0 if ok else 1)


def main():
    parser = argparse.ArgumentParser(
        description='Create a PLATFORM_OWNER user.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--phone', help='10-digit Indian mobile (6-9 prefix)')
    parser.add_argument('--password', help='Must meet signup password rules')
    parser.add_argument('--email', help='Optional email (will be marked verified)')
    parser.add_argument('--first-name', default='Platform')
    parser.add_argument('--last-name', default='Owner')
    args = parser.parse_args()

    # If no flags were supplied, drop into interactive mode.
    if not args.phone and not args.password:
        _run_interactive()
        return

    if not args.phone or not args.password:
        parser.error('--phone and --password must both be supplied in non-interactive mode.')

    try:
        phone = _validate_phone(args.phone)
        _validate_password(args.password)
        _validate_email(args.email)
    except ValueError as exc:
        parser.error(str(exc))

    ok = create_platform_owner(
        phone, args.password, args.email, args.first_name, args.last_name
    )
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
