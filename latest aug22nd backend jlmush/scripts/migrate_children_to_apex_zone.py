"""Move an apex reseller's existing children onto the apex's own zone.

P2/P3 children were provisioned as ``<slug>.<CLOUDFLARE_BASE_DOMAIN>``
(platform-zone placeholder). Once the apex connects its Cloudflare zone
(reseller console → My DNS Zone, or PUT /api/v1/admin/reseller/dns),
this script re-homes each child:

  1. deletes the child's old slug record from the PLATFORM zone
     (skipped when the platform env is unconfigured — local dev), then
  2. re-runs ``sync_tenant`` — which now binds to the apex zone — so
     the child gets ``<slug>.<apex-base>`` and its row's ``fqdn`` /
     ``dns_status`` reflect the move.

Dry-run by default; ``--apply`` executes. Idempotent: children whose
``fqdn`` already lives under the apex base are skipped, and both the
delete and the re-sync tolerate reruns (records are upserted / missing
deletes swallowed). Old platform-zone hostnames stop resolving once the
platform record is gone — coordinate the run with the reseller.

Usage (inside the backend container):

    docker exec -w /app -e PYTHONPATH=/app jlmush-backend \\
        python scripts/migrate_children_to_apex_zone.py --apex larazen [--apply]
"""
import argparse
import sys

from app import create_app


def main():
    parser = argparse.ArgumentParser(
        description="Re-home an apex's children onto its own DNS zone.")
    parser.add_argument('--apex', required=True,
                        help='Slug of the apex reseller tenant.')
    parser.add_argument('--apply', action='store_true',
                        help='Execute (default: dry-run report only).')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        from app.models import Tenant, TenantDnsConfig
        from app.services.cloudflare_dns import (
            CloudflareDnsService, CloudflareConfigError, platform_binding,
        )

        apex = Tenant.query.filter_by(slug=args.apex, is_deleted=False).first()
        if apex is None:
            raise SystemExit(f'No tenant with slug "{args.apex}".')
        cfg = TenantDnsConfig.for_tenant(apex.id)
        if cfg is None or not cfg.dns_ready:
            raise SystemExit(
                f'"{args.apex}" has no ready DNS config — connect the zone '
                'in the reseller console first (base domain + zone id + '
                'API token).')

        try:
            plat = platform_binding()
        except CloudflareConfigError:
            plat = None  # local dev / unconfigured platform zone

        children = (Tenant.query
                    .filter_by(parent_tenant_id=apex.id, is_deleted=False)
                    .order_by(Tenant.created_at.asc())
                    .all())
        if not children:
            print(f'"{args.apex}" has no children; nothing to do.', flush=True)
            return

        apex_suffix = '.' + cfg.base_domain
        todo = []
        for child in children:
            if child.fqdn and child.fqdn.endswith(apex_suffix):
                print(f'  = {child.slug}: already on {cfg.base_domain} '
                      f'({child.fqdn})', flush=True)
                continue
            todo.append(child)
            print(f'  > {child.slug}: {child.fqdn or "(no fqdn)"} '
                  f'-> {child.slug}{apex_suffix}', flush=True)

        if not todo:
            print('All children already on the apex zone.', flush=True)
            return
        if not args.apply:
            print(f'\nDRY RUN — {len(todo)} child(ren) would move. '
                  'Re-run with --apply.', flush=True)
            return

        moved = failed = 0
        for child in todo:
            # 1. Tear the old platform-zone record down (best-effort;
            #    nothing to do when the platform zone isn't configured).
            if plat is not None and child.dns_record_id:
                try:
                    CloudflareDnsService.delete_record(
                        child.dns_record_id, binding=plat)
                    child.dns_record_id = None
                except Exception as e:  # noqa: BLE001 — keep moving
                    print(f'  ! {child.slug}: platform-record delete failed '
                          f'({str(e)[:120]}) — continuing', flush=True)
            # 2. Re-provision — binding_for_tenant now picks the apex zone.
            CloudflareDnsService.sync_tenant(child, scope='subdomain')
            if child.dns_status == 'active':
                moved += 1
                print(f'  + {child.slug}: -> {child.fqdn}', flush=True)
            else:
                failed += 1
                print(f'  ! {child.slug}: dns_status={child.dns_status} '
                      f'error={str(child.dns_error)[:160]}', flush=True)

        print(f'\nDone: {moved} moved, {failed} failed, '
              f'{len(children) - len(todo)} already in place.', flush=True)
        if failed:
            print('Failed children keep their previous routing state; '
                  'fix the zone credentials and re-run (idempotent), or '
                  'resync per child from the platform console.', flush=True)
            sys.exit(1)


if __name__ == '__main__':
    main()
