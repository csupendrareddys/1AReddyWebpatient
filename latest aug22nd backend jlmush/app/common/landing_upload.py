"""Shared landing-asset upload handler.

Both the tenant landing editor (``/api/landing/admin/upload-asset``) and the
platform-owner landing editor (``/api/platform-landing/admin/upload-asset``)
need the identical "take a multipart ``image`` file, push it to the public S3
bucket, hand back a permanent public URL" behaviour. The two routes differ only
in their auth gating (SUPER_ADMIN/SUB_ADMIN + landing-builder RBAC vs
PLATFORM_OWNER), so the body lives here once and each route wraps it with its
own decorators — no duplicated S3 plumbing.

No DB writes: the returned URL is dropped straight into the module/feature
``img_json`` / ``vid_json`` (or a logo field) and persisted through the normal
config-save flow, so re-picking a file before saving never orphans a DB row.
"""
from flask import request

from app.common.responses import error_response, success_response


def handle_landing_asset_upload():
    """Upload the request's ``image`` file to public S3 and return its URL.

    Expects ``multipart/form-data`` with:
      * ``image`` — the file (image OR video; ``S3Service`` validates type/size
        per ``kind``).
      * ``kind``  — optional slug used as the S3 path prefix and asset type
        (``logo`` default; e.g. ``image`` / ``video`` for gallery uploads so
        the per-type extension + size caps apply).

    Returns a Flask ``success_response`` with
    ``{ url, s3_key, content_type, file_size_bytes }`` on success, or an
    ``error_response`` (400) on a missing/empty file or a type/size rejection.
    """
    from app.services.s3_service import S3Service

    if 'image' not in request.files:
        return error_response(
            'No file in request — attach a file under the "image" field.',
            status_code=400,
        )
    upload = request.files['image']
    if not upload or not (upload.filename or '').strip():
        return error_response('Empty file uploaded.', status_code=400)

    # ``kind`` drives both the S3 folder layout and — via ``asset_type`` —
    # the per-type validation in S3Service (``video`` → mp4/webm/…, 5 MB;
    # ``thumbnail`` → png/jpg/…, 1 MB; anything else → global rules).
    raw_kind = (request.form.get('kind') or 'logo').strip().lower()
    safe_kind = ''.join(c if (c.isalnum() or c == '_') else '_' for c in raw_kind)[:32]
    asset_type = safe_kind or 'logo'

    try:
        uploaded = S3Service.upload_file(
            upload,
            asset_type=asset_type,
            original_filename=upload.filename,
            is_private=False,
            folder='page-config',
        )
    except ValueError as exc:
        # ValueError = file-type / size-limit rejection → clean 400 with the
        # actionable message.
        return error_response(str(exc), status_code=400)

    public_url = S3Service.get_public_url(
        bucket=uploaded['s3_bucket'],
        key=uploaded['s3_key'],
        region=uploaded['s3_region'],
    )
    return success_response(data={
        'url': public_url,
        's3_key': uploaded['s3_key'],
        'content_type': uploaded['content_type'],
        'file_size_bytes': uploaded['file_size_bytes'],
    })
