"""Relocate legacy S3 objects into the per-tenant key layout.

    python scripts/migrate_s3_tenant_layout.py                 # dry-run
    python scripts/migrate_s3_tenant_layout.py --tenant <id>   # one tenant
    python scripts/migrate_s3_tenant_layout.py --apply

Tier 3 of the media restructure (tiers 1–2: per-tenant keys for NEW
uploads + the media_assets backfill). For every MediaAsset whose key
predates the layout (doesn't start ``tenants/`` or ``platform/``):

  1. COPY the object to ``tenants/<tid>/[public/]<old_key>`` (or
     ``platform/...`` for vendor assets) — old path preserved under the
     prefix for traceability; uuid filenames make collisions impossible;
  2. verify the copy (size match on HEAD);
  3. update the MediaAsset row AND every legacy ``*_s3_key`` column
     still pointing at the old key (introspected across all models —
     PDF services and signature reads presign from those columns);
  4. commit, then DELETE the old object.

Order matters: the delete happens only after the DB names the new
location, so a crash mid-run leaves at worst a duplicate object, never
a dangling reference. Re-running skips already-migrated keys —
resumable per tenant. Clients see none of this: they hold
``/api/v1/media/<id>`` and the redirect follows the row.

Also REPORTS (never auto-fixes) identity/clinical documents found in
the PUBLIC bucket — moving those across buckets changes access
semantics and deserves a deliberate pass.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SENSITIVE_HINTS = ('aadhar', 'certificate', 'registration', 'document',
                   'signature', 'prescription', 'statement', 'passbook')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--tenant', help='limit to one tenant id')
    args = ap.parse_args()

    from app import create_app
    from app.extensions import db
    from app.models import MediaAsset
    from app.services.s3_service import S3Service
    from scripts.backfill_media_assets import discover_paired

    app = create_app()
    with app.app_context():
        public_bucket = app.config['AWS_S3_PUBLIC_BUCKET']
        q = MediaAsset.query
        if args.tenant:
            q = q.filter_by(tenant_id=args.tenant)
        assets = [a for a in q.all()
                  if not a.s3_key.startswith(('tenants/', 'platform/'))]
        print(f'{len(assets)} asset(s) on legacy keys'
              + (f' (tenant {args.tenant})' if args.tenant else ''))

        # Legacy *_s3_key columns to keep in sync, discovered once.
        key_columns = []
        for mapper in db.Model.registry.mappers:
            for base, url_c, key_c, bucket_c in discover_paired(mapper.class_):
                key_columns.append((mapper.class_, url_c, key_c))

        moved = failed = flagged = 0
        for asset in assets:
            old_key = asset.s3_key
            tenant_seg = (f'tenants/{asset.tenant_id}' if asset.tenant_id
                          else 'platform')
            visibility = 'public/' if asset.s3_bucket == public_bucket else ''
            new_key = f'{tenant_seg}/{visibility}{old_key.lstrip("/")}'

            if (asset.s3_bucket == public_bucket
                    and any(h in old_key.lower() for h in SENSITIVE_HINTS)):
                print(f'  FLAG sensitive-in-public-bucket: {old_key[:80]}')
                flagged += 1

            if not args.apply:
                print(f'  would move {asset.s3_bucket}/{old_key[:60]}'
                      f' -> {new_key[:80]}')
                continue

            s3 = S3Service.get_client(asset.s3_bucket)
            try:
                s3.copy_object(
                    Bucket=asset.s3_bucket, Key=new_key,
                    CopySource={'Bucket': asset.s3_bucket, 'Key': old_key})
                src = s3.head_object(Bucket=asset.s3_bucket, Key=old_key)
                dst = s3.head_object(Bucket=asset.s3_bucket, Key=new_key)
                if src['ContentLength'] != dst['ContentLength']:
                    raise RuntimeError('size mismatch after copy')
            except Exception as exc:  # noqa: BLE001 — leave source untouched
                print(f'  FAILED copy {old_key[:70]}: {exc}')
                failed += 1
                continue

            asset.s3_key = new_key
            for model, url_c, key_c in key_columns:
                for row in model.query.filter(
                        getattr(model, key_c) == old_key).all():
                    setattr(row, key_c, new_key)
            db.session.commit()

            try:
                s3.delete_object(Bucket=asset.s3_bucket, Key=old_key)
            except Exception as exc:  # noqa: BLE001 — orphan, not a dangle
                print(f'  WARN old object not deleted {old_key[:70]}: {exc}')
            moved += 1

        print(f'---\n  moved: {moved}  failed: {failed}  '
              f'sensitive-flags: {flagged}'
              + ('' if args.apply else '  (dry-run)'))


if __name__ == '__main__':
    main()
