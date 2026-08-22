"""Backfill legacy media references onto the media_assets rail.

    docker exec -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/backfill_media_assets.py            # dry-run report
    docker exec ... python scripts/backfill_media_assets.py --apply

What it does, per model row (models discovered by introspection — every
mapped class with ``X_url`` + ``X_s3_key`` column pairs, plus an explicit
allowlist of url-only media columns):

  * PAIRED columns (26 across EntityProfile / ProfileSignature /
    ProfileAbout / ProfileEducation / bank records):
      - s3_key present → find-or-create the MediaAsset for
        (bucket, key) and rewrite the ``*_url`` value to the stable
        ``/api/v1/media/<id>`` path. The url column stops holding
        presigned corpses / raw bucket URLs; readers keep working
        (web absolutizes stable paths; PDF services read s3_key).
      - s3_key EMPTY but url parseable as one of OUR bucket URLs →
        repair the key/bucket columns from the URL, then as above.
  * URL-ONLY media columns (tenant/page-config/prescription logos...):
      - parseable as our bucket URL → asset + stable path rewrite.
      - anything else (external links, /uploads local files, already-
        stable paths) → left untouched, counted.

Idempotent: values already ``/api/v1/media/...`` are skipped, and assets
are deduped on (bucket, key). Objects are NOT moved and never deleted —
relocation into the per-tenant key layout is the separate mover phase.

``--hash``: additionally GET each object to fill ``sha256`` (dedup
reporting). Off by default — it downloads every object.
"""
import argparse
import hashlib
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# url-only columns that hold OUR uploaded media (everything else url-only —
# video links, register links, SMS endpoints — is not media and is skipped).
URL_ONLY_ALLOW = {
    ('Tenant', 'logo_url'),
    ('LoginPageConfig', 'logo_url'),
    ('LandingConfig', 'brand_logo_url'),
    ('PlatformLandingConfig', 'brand_logo_url'),
    ('BillingConfig', 'bill_logo_url'),
    ('PrescriptionConfig', 'clinic_logo_url'),
    ('PrescriptionConfig', 'rx_symbol_url'),
    ('AssetLibraryUsage', 'asset_url'),
}

_S3_URL = re.compile(
    r'^https?://(?P<bucket>[a-z0-9.-]+)\.s3[.-][a-z0-9-]+\.amazonaws\.com/(?P<key>.+?)(?:\?.*)?$'
)
_S3_PATH_STYLE = re.compile(
    r'^https?://[^/]+/(?P<bucket>[a-z0-9.-]+)/(?P<key>.+?)(?:\?.*)?$'
)


def parse_bucket_key(url, known_buckets):
    """(bucket, key) when ``url`` addresses one of OUR buckets, else None."""
    if not url or not isinstance(url, str):
        return None
    m = _S3_URL.match(url)
    if m and m.group('bucket') in known_buckets:
        return m.group('bucket'), m.group('key')
    m = _S3_PATH_STYLE.match(url)  # MinIO / path-style
    if m and m.group('bucket') in known_buckets:
        return m.group('bucket'), m.group('key')
    return None


def discover_paired(model):
    cols = set(model.__table__.columns.keys())
    out = []
    for c in cols:
        if c.endswith('_s3_key'):
            base = c[:-7]
            if f'{base}_url' in cols:
                out.append((base,
                            f'{base}_url', c,
                            f'{base}_s3_bucket' if f'{base}_s3_bucket' in cols else None))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--hash', action='store_true',
                    help='GET each object to fill sha256 (slow)')
    args = ap.parse_args()

    from app import create_app
    from app.extensions import db
    from app.models import MediaAsset
    from app.services.s3_service import S3Service

    app = create_app()
    with app.app_context():
        known_buckets = {app.config['AWS_S3_PUBLIC_BUCKET'],
                         app.config['AWS_S3_PRIVATE_BUCKET']}
        stats = {'assets_created': 0, 'assets_reused': 0, 'urls_rewritten': 0,
                 'keys_repaired': 0, 'skipped_stable': 0, 'left_unparseable': 0,
                 'hashed': 0}
        asset_cache = {}

        def get_asset(bucket, key, tenant_id):
            ck = (bucket, key)
            if ck in asset_cache:
                return asset_cache[ck]
            row = MediaAsset.query.filter_by(s3_bucket=bucket, s3_key=key).first()
            if row is None:
                import uuid as _uuid
                row = MediaAsset(
                    id=_uuid.uuid4(), tenant_id=tenant_id,
                    s3_bucket=bucket, s3_key=key,
                    access=(MediaAsset.ACCESS_TENANT
                            if S3Service.is_private_bucket(bucket)
                            else MediaAsset.ACCESS_PUBLIC),
                    asset_type='backfill',
                )
                if args.hash:
                    try:
                        obj = S3Service.get_client(bucket).get_object(
                            Bucket=bucket, Key=key)
                        digest = hashlib.sha256()
                        for chunk in obj['Body'].iter_chunks(1024 * 1024):
                            digest.update(chunk)
                        row.sha256 = digest.hexdigest()
                        row.file_size_bytes = obj.get('ContentLength')
                        row.content_type = obj.get('ContentType')
                        stats['hashed'] += 1
                    except Exception as exc:  # noqa: BLE001 — unreachable object
                        print(f'    hash miss {bucket}/{key[:60]}: {type(exc).__name__}')
                db.session.add(row)
                stats['assets_created'] += 1
            else:
                stats['assets_reused'] += 1
            asset_cache[ck] = row
            return row

        for mapper in db.Model.registry.mappers:
            model = mapper.class_
            name = model.__name__
            paired = discover_paired(model)
            url_only = [c for (m, c) in URL_ONLY_ALLOW if m == name]
            if not paired and not url_only:
                continue
            try:
                rows = model.query.all()
            except Exception as exc:  # noqa: BLE001 — view/abstract models
                print(f'  {name}: query failed ({type(exc).__name__}), skipped')
                continue
            if not rows:
                continue
            touched = 0
            for row in rows:
                # A Tenant row has no tenant_id column — it IS the tenant.
                tenant_id = getattr(row, 'tenant_id', None) or (
                    row.id if name == 'Tenant' else None)
                for base, url_c, key_c, bucket_c in paired:
                    url = getattr(row, url_c, None)
                    key = getattr(row, key_c, None)
                    bucket = getattr(row, bucket_c, None) if bucket_c else None
                    if url and url.startswith('/api/v1/media/'):
                        stats['skipped_stable'] += 1
                        continue
                    if not key and url:
                        parsed = parse_bucket_key(url, known_buckets)
                        if parsed:
                            bucket, key = parsed
                            setattr(row, key_c, key)
                            if bucket_c:
                                setattr(row, bucket_c, bucket)
                            stats['keys_repaired'] += 1
                    if not key:
                        if url:
                            stats['left_unparseable'] += 1
                        continue
                    if not bucket:
                        # Same heuristic get_signed_url uses for key-only rows.
                        bucket = (app.config['AWS_S3_PUBLIC_BUCKET']
                                  if key.lstrip('/').startswith('page-config/')
                                  or '/public/' in key
                                  else app.config['AWS_S3_PRIVATE_BUCKET'])
                        if bucket_c:
                            setattr(row, bucket_c, bucket)
                    asset = get_asset(bucket, key, tenant_id)
                    setattr(row, url_c, asset.url)
                    stats['urls_rewritten'] += 1
                    touched += 1
                for url_c in url_only:
                    url = getattr(row, url_c, None)
                    if not url or url.startswith('/api/v1/media/'):
                        if url:
                            stats['skipped_stable'] += 1
                        continue
                    parsed = parse_bucket_key(url, known_buckets)
                    if not parsed:
                        stats['left_unparseable'] += 1
                        continue
                    asset = get_asset(parsed[0], parsed[1], tenant_id)
                    setattr(row, url_c, asset.url)
                    stats['urls_rewritten'] += 1
                    touched += 1
            if touched:
                print(f'  {name}: {touched} value(s) rewritten')

        # Duplicate-content report (only meaningful with --hash data).
        dupes = db.session.execute(db.text(
            "SELECT tenant_id, sha256, count(*) FROM media_assets "
            "WHERE sha256 IS NOT NULL GROUP BY tenant_id, sha256 "
            "HAVING count(*) > 1")).fetchall()
        if dupes:
            print(f'  duplicate-content groups (same tenant+bytes, different keys): {len(dupes)}')

        print('---')
        for k, v in stats.items():
            print(f'  {k}: {v}')
        if args.apply:
            db.session.commit()
            print('APPLIED.')
        else:
            db.session.rollback()
            print('DRY-RUN — nothing written. Re-run with --apply.')


if __name__ == '__main__':
    main()
