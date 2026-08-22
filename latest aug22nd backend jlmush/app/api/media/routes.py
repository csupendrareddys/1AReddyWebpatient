"""GET /api/v1/media/<id> — the stable door in front of S3.

Clients (web <img> tags via the auth cookie, mobile image components via
a Bearer header) keep this URL forever; each request exchanges it for a
short-lived presigned URL (private bucket) or the public object URL via
a 302. The asset id names the OBJECT, not a grant: change the object's
access or delete the row and every cached link everywhere follows.

Caching: the redirect is marked ``private, max-age=3600`` — safe because
the presigned URL it points at lives twice that (7200s), so a cached
redirect can never hand out an already-dead location. S3 objects are
content-addressed by upload (uuid keys, never overwritten), so the FINAL
response is immutable and clients may cache the bytes aggressively.

Access model (see MediaAsset): ``public`` needs no auth; ``tenant``
needs a verified user of the same tenant. Finer-grained rules stay in
the owning feature's own endpoints — this is the floor for assets whose
URL must be embeddable (images in cards, logos, avatars), not a general
document-authorization system (documents keep app/api/common/document_files).
"""
import logging

from flask import redirect
from flask_jwt_extended import get_jwt, verify_jwt_in_request

from app.api.media import media_assets_bp
from app.common.responses import error_response, not_found_response
from app.models import MediaAsset
from app.services.s3_service import S3Service

logger = logging.getLogger(__name__)

# Presign must comfortably outlive the redirect's max-age (see module doc).
_PRESIGN_SECONDS = 7200
_REDIRECT_MAX_AGE = 3600


@media_assets_bp.route('/<uuid:asset_id>', methods=['GET'])
def resolve_media(asset_id):
    asset = MediaAsset.query.filter_by(id=asset_id).first()
    if asset is None:
        return not_found_response('Media')

    if asset.access != MediaAsset.ACCESS_PUBLIC:
        try:
            verify_jwt_in_request()
        except Exception:  # noqa: BLE001 — missing/expired/garbage token
            return error_response('Authentication required', status_code=401)
        claims = get_jwt()
        if str(claims.get('tenant_id') or '') != str(asset.tenant_id or ''):
            # Same body as an unknown id: a foreign tenant must not learn
            # that the asset exists.
            return not_found_response('Media')

    # Presign for the private bucket AND for MinIO-backed buckets (no
    # anonymous-read bucket policy there — the signed URL IS the access);
    # plain object URL only for the AWS public bucket.
    if (S3Service.is_private_bucket(asset.s3_bucket)
            or S3Service.uses_minio(asset.s3_bucket)):
        target = S3Service.generate_presigned_url(
            asset.s3_bucket, asset.s3_key, expiration=_PRESIGN_SECONDS)
    else:
        target = S3Service.get_public_url_for(asset.s3_bucket, asset.s3_key)
    if not target:
        logger.error('[MEDIA] could not build URL for asset=%s', asset_id)
        return error_response('Media temporarily unavailable', status_code=503)

    resp = redirect(target, code=302)
    resp.headers['Cache-Control'] = f'private, max-age={_REDIRECT_MAX_AGE}'
    return resp
