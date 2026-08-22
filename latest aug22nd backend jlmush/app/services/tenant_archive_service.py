"""TenantArchiveService — export a tenant's rows to S3 before purge.

The retention sweep calls this when a SUSPENDED tenant's
``data_purge_after`` passes: every table carrying a ``tenant_id``
column is dumped as gzipped JSON to the PRIVATE bucket under
``archives/tenants/<tenant_id>/<timestamp>/``, with a manifest
summarising what was written. Only after the upload succeeds does the
caller hard-delete the tenant (which frees the subdomain and slug).

Values are serialised as-is: encrypted columns stay encrypted (the
archive is only readable back through the application's keys, which
is the right property for parked healthcare data). MinIO serves the
same API locally, so the flow is fully testable offline.
"""
import gzip
import json
import logging

from flask import current_app

from app.extensions import db

logger = logging.getLogger(__name__)


class TenantArchiveService:

    @staticmethod
    def _tenant_tables():
        """Every mapped table name with a ``tenant_id`` column, sorted by
        name (archives don't need dependency order, and sorted_tables
        warns on the appointments/prescriptions FK cycle)."""
        return sorted(
            t.name for t in db.metadata.tables.values() if 'tenant_id' in t.c
        )

    @classmethod
    def archive_tenant(cls, tenant_id):
        """Upload the tenant's rows; returns {prefix, tables, rows}.

        Raises on any upload failure — the caller must NOT delete data
        whose archive is not fully on S3.
        """
        from app.common.tenant_context import with_tenant_context
        from app.models import Tenant
        from app.models._base import utcnow
        from app.services.s3_service import S3Service

        tenant = Tenant.query.filter_by(id=tenant_id).first()
        if tenant is None:
            raise ValueError(f'Tenant {tenant_id} not found')

        bucket = current_app.config.get('AWS_S3_PRIVATE_BUCKET')
        if not bucket:
            raise ValueError('AWS_S3_PRIVATE_BUCKET is not configured — '
                             'refusing to purge without an archive target.')
        client = S3Service.get_client(bucket)

        stamp = utcnow().strftime('%Y%m%dT%H%M%SZ')
        prefix = f'archives/tenants/{tenant_id}/{stamp}/'
        manifest = {
            'tenant_id': str(tenant_id),
            'tenant_slug': tenant.slug,
            'tenant_name': tenant.name,
            'exported_at': utcnow().isoformat(),
            'tables': {},
        }
        total_rows = 0

        with with_tenant_context(tenant_id):
            for table_name in cls._tenant_tables():
                # SELECT * against the LIVE table, not the model's column
                # list — a model column awaiting its migration (schema
                # drift) must not block an archive of what actually
                # exists. Table names come from our own metadata, so the
                # interpolation is safe.
                rows = db.session.execute(
                    db.text(f'SELECT * FROM "{table_name}" '
                            'WHERE tenant_id = :tid'),
                    {'tid': str(tenant_id)},
                ).mappings().all()
                if not rows:
                    continue
                payload = json.dumps(
                    [dict(r) for r in rows], default=str,
                ).encode('utf-8')
                key = f'{prefix}{table_name}.json.gz'
                client.put_object(
                    Bucket=bucket, Key=key,
                    Body=gzip.compress(payload),
                    ContentType='application/gzip',
                )
                manifest['tables'][table_name] = len(rows)
                total_rows += len(rows)

        # The tenant row itself (no tenant_id column on ``tenants``).
        client.put_object(
            Bucket=bucket, Key=f'{prefix}tenant.json.gz',
            Body=gzip.compress(json.dumps(
                tenant.to_dict(), default=str).encode('utf-8')),
            ContentType='application/gzip',
        )
        # Relocate the tenant's OBJECT STORAGE too — the per-tenant key
        # layout exists precisely so offboarding is a prefix move. The
        # binaries (documents, images) are copied into the archive and
        # deleted from the live buckets; a failure raises, which aborts
        # the purge before anything is destroyed.
        moved = cls._relocate_objects(client, bucket, tenant_id, prefix)
        manifest['objects_moved'] = moved

        client.put_object(
            Bucket=bucket, Key=f'{prefix}manifest.json',
            Body=json.dumps(manifest, indent=1).encode('utf-8'),
            ContentType='application/json',
        )
        logger.warning('[ARCHIVE] tenant %s (%s): %d tables, %d rows, '
                       '%d objects -> s3://%s/%s', tenant_id, tenant.slug,
                       len(manifest['tables']), total_rows, moved,
                       bucket, prefix)
        return {'prefix': prefix, 'bucket': bucket,
                'tables': len(manifest['tables']), 'rows': total_rows,
                'objects': moved}

    @staticmethod
    def _relocate_objects(archive_client, archive_bucket, tenant_id,
                          prefix):
        """Move every object under the tenant's prefix, in BOTH live
        buckets, into the archive prefix. Returns the count moved."""
        from app.services.s3_service import S3Service

        moved = 0
        buckets = []
        for cfg_key in ('AWS_S3_PUBLIC_BUCKET', 'AWS_S3_PRIVATE_BUCKET'):
            name = current_app.config.get(cfg_key)
            if name:
                buckets.append(name)
        for live_bucket in buckets:
            client = S3Service.get_client(live_bucket)
            token = None
            while True:
                kwargs = {'Bucket': live_bucket,
                          'Prefix': f'tenants/{tenant_id}/'}
                if token:
                    kwargs['ContinuationToken'] = token
                page = client.list_objects_v2(**kwargs)
                keys = [o['Key'] for o in page.get('Contents') or []]
                for key in keys:
                    archive_client.copy_object(
                        Bucket=archive_bucket,
                        Key=f'{prefix}objects/{live_bucket}/{key}',
                        CopySource={'Bucket': live_bucket, 'Key': key},
                    )
                if keys:
                    client.delete_objects(
                        Bucket=live_bucket,
                        Delete={'Objects': [{'Key': k} for k in keys],
                                'Quiet': True},
                    )
                    moved += len(keys)
                if not page.get('IsTruncated'):
                    break
                token = page.get('NextContinuationToken')
        return moved
