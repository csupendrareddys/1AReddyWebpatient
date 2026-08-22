"""Vendor-tenant bootstrap — the first row a brand-new deployment needs.

Creates ONLY the SaaS vendor tenant. Nothing else: no customer tenants,
no plans, no users. That is the whole point — ``bootstrap_local.py`` also
manufactures a ``larazen`` customer, a ``plan1`` and an owner with a
hardcoded password, which is right for a laptop and wrong for production.

Why a fresh database cannot start without this:

  * ``is_default`` decides where an unresolved anonymous request lands.
    With no such row, every anonymous hit on the API has no tenant to
    resolve to.
  * ``create_platform_owner.py`` (repo root) refuses to run until an
    ``is_default`` tenant exists — so the platform owner cannot be
    created first. This script is the step before it.
  * ``is_platform`` is the entitlement-bypass row the vendor console
    needs. It is deliberately separate from ``is_default``; see the
    backend CLAUDE.md. Exactly one platform row may exist (enforced by
    the partial unique index ``ux_tenants_single_platform``).

``auto_subdomain`` is False because the vendor owns the zone apex
itself — it is not a ``<slug>.<base_domain>`` tenant.

Setting ``--domain`` is optional but recommended. Without it the apex
still resolves to the vendor through the ``is_default`` fallback, but
the host is undeclared, and the frontend's ``VITE_PLATFORM_APEX_HOSTS``
is then asserting something the database does not confirm. Declare the
host in both places, or in neither.

USAGE (inside the backend container)
------------------------------------
    docker exec jlmush-backend python scripts/bootstrap_vendor.py \
        --domain jlmush.in

    # inspect without writing
    docker exec jlmush-backend python scripts/bootstrap_vendor.py \
        --domain jlmush.in --dry-run

Idempotent: re-running reports the existing vendor and changes nothing,
except that ``--domain`` is applied if the row has no domain yet. It
will NOT overwrite a domain that is already set — that would silently
move the vendor's host — use ``--force-domain`` to do it deliberately.

EXIT CODES
----------
    0 — vendor tenant is in place (created now or already existed)
    1 — a pre-flight check failed; nothing was written
"""
import argparse
import os
import re
import sys

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

# Bare hostname: no scheme, no path, no port. Mirrors the shape the
# frontend's VITE_PLATFORM_APEX_HOSTS expects.
_HOST_RE = re.compile(r'^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$')


def bootstrap(name, slug, domain, force_domain, dry_run):
    from datetime import datetime, timezone

    from app import create_app
    from app.extensions import db
    from app.models import Tenant, TenantStatus

    app = create_app()
    with app.app_context():
        existing = Tenant.query.filter_by(
            is_platform=True, is_deleted=False,
        ).first()

        if existing:
            print('[--] vendor tenant already exists '
                  f'({existing.slug} / {existing.id})')
            print(f'     domain      : {existing.domain or "(none)"}')
            print(f'     is_default  : {existing.is_default}')

            if domain and existing.domain != domain:
                if existing.domain and not force_domain:
                    print(f'[!!] refusing to change domain '
                          f'{existing.domain!r} -> {domain!r}. '
                          'Re-run with --force-domain if that is intended.')
                    return False
                if dry_run:
                    print(f'[dry-run] would set domain -> {domain}')
                    return True
                existing.domain = domain
                existing.domain_verification_status = 'verified'
                existing.domain_verified_at = datetime.now(timezone.utc)
                db.session.commit()
                print(f'[OK] domain set -> {domain}')

            if not existing.is_default:
                # Nothing else can be the fallback while a platform row
                # exists without one; surface it rather than guessing.
                print('[!!] vendor is not is_default — unresolved anonymous '
                      'requests have nowhere to land. Check whether another '
                      'tenant holds is_default deliberately.')
            return True

        # ── create ────────────────────────────────────────────────────
        if dry_run:
            print(f'[dry-run] would create vendor tenant slug={slug!r} '
                  f'name={name!r} domain={domain or "(none)"} '
                  'is_platform=True is_default=True auto_subdomain=False')
            return True

        vendor = Tenant(
            name=name,
            slug=slug,
            is_platform=True,
            is_default=True,
            auto_subdomain=False,        # owns the zone apex itself
            status=TenantStatus.ACTIVE,
        )
        if domain:
            vendor.domain = domain
            vendor.domain_verification_status = 'verified'
            vendor.domain_verified_at = datetime.now(timezone.utc)

        db.session.add(vendor)
        db.session.commit()

        print(f'[OK] created vendor tenant ({vendor.id})')
        print(f'     slug        : {vendor.slug}')
        print(f'     domain      : {vendor.domain or "(none — is_default fallback only)"}')
        print('     is_platform : True   (entitlement bypass)')
        print('     is_default  : True   (anonymous fallback)')
        print()
        print('Next: create the platform owner —')
        print('  python create_platform_owner.py --phone <...> --password <...> '
              '--email <...> --first-name <...> --last-name <...>')
        return True


def main():
    ap = argparse.ArgumentParser(
        description='Create the SaaS vendor tenant on a fresh database.')
    ap.add_argument('--name', default='SaaS Platform',
                    help='Display name (default: "SaaS Platform").')
    ap.add_argument('--slug', default='vendor',
                    help='Tenant slug (default: "vendor").')
    ap.add_argument('--domain', default=None,
                    help='Vendor apex host, e.g. jlmush.in. Bare hostname: '
                         'no scheme, no www, no trailing slash. Must match '
                         "the frontend's VITE_PLATFORM_APEX_HOSTS.")
    ap.add_argument('--force-domain', action='store_true',
                    help='Allow replacing a domain that is already set.')
    ap.add_argument('--dry-run', action='store_true',
                    help='Report what would happen; write nothing.')
    args = ap.parse_args()

    if args.domain:
        args.domain = args.domain.strip().lower().rstrip('.')
        if args.domain.startswith('www.'):
            print('[ERR] --domain must be the bare apex, not the www form.')
            return 1
        if not _HOST_RE.match(args.domain):
            print(f'[ERR] --domain {args.domain!r} is not a bare hostname.')
            return 1

    try:
        ok = bootstrap(args.name, args.slug, args.domain,
                       args.force_domain, args.dry_run)
    except Exception:
        import traceback
        traceback.print_exc()
        return 1
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
