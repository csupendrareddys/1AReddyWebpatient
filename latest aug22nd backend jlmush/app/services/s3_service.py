"""AWS S3 Service for asset management."""
import boto3
import uuid
from botocore.exceptions import ClientError
from flask import current_app


# Per-asset-type validation rules. When the asset_type is one of these keys
# we override the global ``ALLOWED_EXTENSIONS`` config and enforce a tighter
# size cap, so a 500 MB mp4 can't slip through under the generic ``logo``
# upload path. Any asset_type not listed here uses the global allowlist with
# no enforced size cap (unchanged from the original behaviour).
#
# The ``max_size_bytes`` here are only FALLBACKS — the live cap comes from
# ``current_app.config['MEDIA_UPLOAD_MAX_BYTES']`` (see config.py), which is the
# single source of truth so limits can be changed in one place / per env.
_PER_TYPE_RULES = {
    'video': {
        'extensions': {'mp4', 'webm', 'mov', 'm4v', 'ogg'},
        'max_size_bytes': 20 * 1024 * 1024,   # 20 MB (fallback; see config)
        'label': 'video',
    },
    'thumbnail': {
        'extensions': {'png', 'jpg', 'jpeg', 'gif', 'webp'},
        'max_size_bytes': 1 * 1024 * 1024,    # 1 MB (fallback; see config)
        'label': 'thumbnail image',
    },
    # Gallery images (module / feature img_json).
    'image': {
        'extensions': {'png', 'jpg', 'jpeg', 'gif', 'webp'},
        'max_size_bytes': 2 * 1024 * 1024,    # 2 MB (fallback; see config)
        'label': 'image',
    },
    # Service-communication channel documents (patient/provider uploads).
    # PDF + common image types only, capped at 5 MB. Being present in
    # _PER_TYPE_RULES is what actually enforces the size cap — asset types
    # absent from this map get no size check (only Flask's 25 MB ceiling).
    'medical_document': {
        'extensions': {'pdf', 'png', 'jpg', 'jpeg'},
        'max_size_bytes': 5 * 1024 * 1024,    # 5 MB (fallback; see config)
        'label': 'document',
    },
    # Profile pictures (all roles, media_routes.py). Image types only —
    # the global ALLOWED_EXTENSIONS fallback would admit PDFs and refuse
    # webp, both wrong for an avatar.
    'profile_image': {
        'extensions': {'png', 'jpg', 'jpeg', 'gif', 'webp'},
        'max_size_bytes': 5 * 1024 * 1024,    # 5 MB
        'label': 'profile picture',
    },
}


def _max_size_for(asset_type, fallback):
    """Live per-type cap: config is source of truth, ``fallback`` if unset."""
    caps = current_app.config.get('MEDIA_UPLOAD_MAX_BYTES') or {}
    return caps.get(asset_type, fallback)


def _human_size(num_bytes: int) -> str:
    if num_bytes >= 1024 * 1024:
        return f"{num_bytes / (1024 * 1024):.1f} MB"
    if num_bytes >= 1024:
        return f"{num_bytes / 1024:.0f} KB"
    return f"{num_bytes} B"


class S3Service:
    """Service for AWS S3 operations."""

    # ── MinIO routing (local dev) ────────────────────────────────────────
    # When ``MINIO_ENDPOINT_URL`` is configured, PRIVATE-bucket traffic is
    # served by a local MinIO rather than AWS. The PUBLIC bucket always goes
    # to real S3 so a restored prod DB keeps rendering live logos / homepage
    # assets. With the config unset (production) every path below collapses
    # to the original AWS-only behaviour.
    #
    # Routing keys off the BUCKET NAME rather than an ``is_private`` flag,
    # because most entry points (``generate_presigned_url``, ``delete_file``,
    # ``file_exists``) only receive the bucket that was persisted alongside
    # the key — there is no flag left to consult by then.

    @staticmethod
    def _minio_endpoint(for_presign: bool = False) -> str | None:
        """MinIO endpoint, or None when MinIO routing is disabled.

        Two endpoints exist because SigV4 signs the Host header: the backend
        container reaches MinIO at ``http://minio:9000`` while the browser
        must use ``http://localhost:9000``. A URL presigned for the internal
        host fails when the browser fetches it, so presigning uses the
        public-facing endpoint.
        """
        internal = current_app.config.get('MINIO_ENDPOINT_URL')
        if not internal:
            return None
        if for_presign:
            return current_app.config.get('MINIO_PUBLIC_ENDPOINT_URL') or internal
        return internal

    @staticmethod
    def uses_minio(bucket: str | None) -> bool:
        """True when ``bucket`` is MinIO-routed.

        Default: only the private bucket (see the block comment above).
        ``MINIO_ALL_BUCKETS=true`` routes the public bucket to MinIO too —
        for dev machines with NO AWS credentials at all, where "public
        bucket goes to real S3" just means every upload fails. Production
        leaves both settings unset.
        """
        if not bucket or not S3Service._minio_endpoint():
            return False
        if bucket == current_app.config['AWS_S3_PRIVATE_BUCKET']:
            return True
        import os as _os
        return (_os.environ.get('MINIO_ALL_BUCKETS', '').lower() == 'true'
                and bucket == current_app.config['AWS_S3_PUBLIC_BUCKET'])

    @staticmethod
    def get_client(bucket: str | None = None, for_presign: bool = False):
        """S3 client for ``bucket``.

        Returns a MinIO-backed client for the private bucket when MinIO is
        enabled, and the AWS client otherwise. ``bucket=None`` always yields
        the AWS client.
        """
        from botocore.config import Config
        if S3Service.uses_minio(bucket):
            return boto3.client(
                's3',
                aws_access_key_id=current_app.config['MINIO_ACCESS_KEY'],
                aws_secret_access_key=current_app.config['MINIO_SECRET_KEY'],
                region_name=current_app.config['MINIO_REGION'],
                endpoint_url=S3Service._minio_endpoint(for_presign),
                # Path-style addressing is required: the virtual-hosted form
                # ``bucket.minio:9000`` has no DNS entry to resolve.
                config=Config(
                    signature_version='s3v4',
                    s3={'addressing_style': 'path'},
                ),
            )
        region = current_app.config['AWS_S3_REGION']
        return boto3.client(
            's3',
            aws_access_key_id=current_app.config['AWS_ACCESS_KEY_ID'],
            aws_secret_access_key=current_app.config['AWS_SECRET_ACCESS_KEY'],
            region_name=region,
            endpoint_url=f"https://s3.{region}.amazonaws.com",
            config=Config(signature_version='s3v4')
        )

    @staticmethod
    def upload_file(file_obj, asset_type: str, original_filename: str, is_private: bool = False, folder: str = 'page-config') -> dict:
        """
        Upload file to S3.
        
        Args:
            file_obj: File object from request.files
            asset_type: Type of asset (logo, favicon, certificate, prescription, etc.)
            original_filename: Original filename
            is_private: If True, uploads to the private bucket (certificates, prescriptions,
                        appointment documents). If False (default), uploads to the public
                        bucket (logos, T&C, homepage assets, symptom photos).
            folder: Root folder prefix in S3. Defaults to 'page-config'. Use 'doctors/documents'
                    for doctor identity documents, etc.
            
        Returns:
            dict with s3_key, s3_bucket, s3_region, content_type, file_size_bytes
        """
        bucket_key = 'AWS_S3_PRIVATE_BUCKET' if is_private else 'AWS_S3_PUBLIC_BUCKET'
        bucket = current_app.config[bucket_key]
        s3 = S3Service.get_client(bucket)
        # Record the region the object actually lives in, so a MinIO-stored
        # object isn't stamped with an AWS region it was never written to.
        region = (
            current_app.config['MINIO_REGION'] if S3Service.uses_minio(bucket)
            else current_app.config['AWS_S3_REGION']
        )

        # Generate unique filename
        file_ext = original_filename.rsplit('.', 1)[-1].lower() if '.' in original_filename else ''

        # Validate file extension. Video / thumbnail asset types use a tighter
        # per-type allowlist; everything else falls back to the global
        # ``ALLOWED_EXTENSIONS`` config so existing logo / favicon / document
        # uploads behave exactly as before.
        type_rules = _PER_TYPE_RULES.get(asset_type)
        if type_rules:
            allowed = type_rules['extensions']
        else:
            allowed = current_app.config.get('ALLOWED_EXTENSIONS', {'png', 'jpg', 'jpeg', 'gif', 'pdf'})
        if file_ext not in allowed:
            raise ValueError(f"File type '.{file_ext}' is not allowed. Permitted: {', '.join(sorted(allowed))}")

        unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex

        # ── Per-tenant key layout ────────────────────────────────────────
        #   tenants/<tenant_id>/[public/]<folder>/<asset_type>/<uuid>.<ext>
        #   platform/[public/]<folder>/<asset_type>/<uuid>.<ext>
        # One prefix per tenant makes offboarding/DPDP erasure a single
        # recursive delete, storage metering a single prefix listing, and
        # lifecycle rules scopeable per area. The ``public/`` marker keeps
        # bucket detection deterministic for key-only legacy readers
        # (see get_signed_url). Objects written before this layout stay at
        # their old ``<folder>/<asset_type>/...`` keys — the media_assets
        # registry stores bucket+key per object, so clients (who only see
        # /api/v1/media/<id>) never notice either scheme.
        tenant_seg = 'platform'
        try:
            from flask import g
            if getattr(g, 'tenant_id', None):
                tenant_seg = f"tenants/{g.tenant_id}"
        except RuntimeError:  # outside a request (scripts/jobs)
            pass
        visibility_seg = '' if is_private else 'public/'
        s3_key = (f"{tenant_seg}/{visibility_seg}{folder.strip('/')}/"
                  f"{asset_type}/{unique_filename}")

        content_type = getattr(file_obj, 'content_type', None) or 'application/octet-stream'

        # Get file size
        file_obj.seek(0, 2)
        file_size = file_obj.tell()
        file_obj.seek(0)

        # Enforce per-type size cap. Done AFTER the extension check so the
        # error message the admin sees first is the one they can act on
        # quickest (wrong file type → pick a different file; too big → trim
        # / re-encode).
        if type_rules:
            max_bytes = _max_size_for(asset_type, type_rules['max_size_bytes'])
            if file_size > max_bytes:
                raise ValueError(
                    f"{type_rules['label'].capitalize()} is too large "
                    f"({_human_size(file_size)}). Max allowed: {_human_size(max_bytes)}."
                )
        
        # Content hash — powers upload dedup (same tenant + same bytes +
        # same bucket → reuse the existing object and asset row) and gives
        # every asset a fingerprint. One streaming pass, then rewind.
        import hashlib
        digest = hashlib.sha256()
        for chunk in iter(lambda: file_obj.read(1024 * 1024), b''):
            digest.update(chunk)
        sha256 = digest.hexdigest()
        file_obj.seek(0)

        tenant_id = None
        try:
            from flask import g
            tenant_id = getattr(g, 'tenant_id', None)
        except RuntimeError:  # outside a request (scripts/jobs)
            pass

        from app.extensions import db
        from app.models.media_asset import MediaAsset

        existing = MediaAsset.query.filter_by(
            tenant_id=tenant_id, sha256=sha256, s3_bucket=bucket,
        ).first()
        if existing is not None:
            # Same bytes already stored for this tenant — no second S3
            # object, no second row. Callers get the original's identity.
            return {
                's3_key': existing.s3_key,
                's3_bucket': existing.s3_bucket,
                's3_region': region,
                'content_type': existing.content_type or content_type,
                'file_size_bytes': existing.file_size_bytes or file_size,
                'media_id': str(existing.id),
                'media_url': existing.url,
                'deduplicated': True,
            }

        # Upload. Never send per-object ACLs: the AWS buckets enforce
        # bucket-owner ownership (the modern S3 default), which rejects any
        # ACL with AccessControlListNotSupported, and MinIO rejects canned
        # ACLs unless legacy emulation is on. Public read on the AWS public
        # bucket comes from its Terraform-managed bucket policy; MinIO and
        # the private bucket are served via presigned URLs instead.
        extra_args = {'ContentType': content_type}
        s3.upload_fileobj(
            file_obj,
            bucket,
            s3_key,
            ExtraArgs=extra_args
        )

        # Register the stable-URL row. Joins the CALLER's transaction (no
        # commit here): a rolled-back flow leaves no row. created_by is
        # best-effort — uploads happen in unauthenticated signup flows too.
        created_by = None
        try:
            from flask_jwt_extended import get_jwt_identity
            created_by = get_jwt_identity()
        except Exception:  # noqa: BLE001
            pass
        asset = MediaAsset(
            id=uuid.uuid4(),  # client-side id: ``asset.url`` valid pre-flush
            tenant_id=tenant_id,
            s3_bucket=bucket,
            s3_key=s3_key,
            content_type=content_type,
            file_size_bytes=file_size,
            sha256=sha256,
            access=(MediaAsset.ACCESS_TENANT if is_private
                    else MediaAsset.ACCESS_PUBLIC),
            asset_type=asset_type,
            created_by=created_by,
        )
        db.session.add(asset)

        return {
            's3_key': s3_key,
            's3_bucket': bucket,
            's3_region': region,
            'content_type': content_type,
            'file_size_bytes': file_size,
            'media_id': str(asset.id),
            'media_url': asset.url,
            'deduplicated': False,
        }
    
    @staticmethod
    def generate_presigned_url(bucket: str, key: str, expiration: int = 3600) -> str | None:
        """
        Generate presigned URL for secure access.
        
        Args:
            bucket: S3 bucket name
            key: S3 object key
            expiration: URL expiration time in seconds (default 1 hour)
            
        Returns:
            Presigned URL string or None if error
        """
        s3 = S3Service.get_client(bucket, for_presign=True)
        try:
            return s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket, 'Key': key},
                ExpiresIn=expiration
            )
        except ClientError as e:
            current_app.logger.error(f"Error generating presigned URL: {e}")
            return None
    
    @staticmethod
    def get_signed_url(s3_key, asset_type=None, expiration=3600):
        """
        Convenience wrapper: generate a presigned URL from just the stored S3 key.

        Bucket selection: identity documents (Aadhaar, registration
        certificates) were historically uploaded with the default
        ``folder='page-config'`` argument to ``upload_file`` and went
        to the PUBLIC bucket. Signing those keys against the private
        bucket produces ``NoSuchKey`` because the file lives in the
        other bucket. We detect the bucket from the key prefix:

          * ``page-config/...`` — legacy / public-bucket uploads;
            signed against ``AWS_S3_PUBLIC_BUCKET``.
          * Anything else (``facility-documents/...``, ``doctors/...``)
            — private bucket.

        Args:
            s3_key: The S3 object key stored in the database
            asset_type: Unused, kept for call-site compatibility
            expiration: URL expiration in seconds (default 1 hour)

        Returns:
            Presigned URL string, or None if key is empty/None
        """
        if not s3_key:
            return None
        # Strip a leading slash so prefix detection isn't fooled by
        # ``/page-config/...`` shapes that older callers may persist.
        normalized = s3_key.lstrip('/')
        if normalized.startswith('page-config/') or '/public/' in normalized:
            # Legacy public-bucket prefix, or the tenant-layout ``public/``
            # visibility marker (tenants/<id>/public/...).
            bucket = current_app.config['AWS_S3_PUBLIC_BUCKET']
        else:
            bucket = current_app.config['AWS_S3_PRIVATE_BUCKET']
        return S3Service.generate_presigned_url(bucket, s3_key, expiration)

    @staticmethod
    def is_private_bucket(bucket: str | None) -> bool:
        """Objects in the private bucket need presigned access; the public
        bucket serves plain object URLs."""
        return bucket == current_app.config['AWS_S3_PRIVATE_BUCKET']

    @staticmethod
    def get_public_url_for(bucket: str, key: str) -> str:
        """Public object URL with the region resolved for the bucket
        (MinIO-backed buckets use their configured endpoint, AWS ones the
        configured region)."""
        if S3Service.uses_minio(bucket):
            endpoint = S3Service._minio_endpoint(for_presign=True)
            if endpoint:
                return f"{endpoint.rstrip('/')}/{bucket}/{key}"
        return S3Service.get_public_url(
            bucket, key, current_app.config['AWS_S3_REGION'])

    @staticmethod
    def get_public_url(bucket: str, key: str, region: str) -> str:
        """
        Generate public URL for a file (requires bucket/folder to be public).
        
        Args:
            bucket: S3 bucket name
            key: S3 object key
            region: AWS region
            
        Returns:
            Public URL string
        """
        return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"
    
    @staticmethod
    def delete_file(bucket: str, key: str) -> bool:
        """
        Delete file from S3.
        
        Args:
            bucket: S3 bucket name
            key: S3 object key
            
        Returns:
            True if successful, False otherwise
        """
        s3 = S3Service.get_client(bucket)
        try:
            s3.delete_object(Bucket=bucket, Key=key)
            return True
        except ClientError as e:
            current_app.logger.error(f"Error deleting S3 object: {e}")
            return False
    
    @staticmethod
    def file_exists(bucket: str, key: str) -> bool:
        """Check if file exists in S3."""
        s3 = S3Service.get_client(bucket)
        try:
            s3.head_object(Bucket=bucket, Key=key)
            return True
        except ClientError:
            return False
