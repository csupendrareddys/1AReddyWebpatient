"""Shared media uploads — one endpoint every vertical uses.

Profile pictures are a deliberate self-service action (not an approval-gated
field change), so this saves the file and sets the caller's ``User.profile_image``
directly — working immediately for a doctor, patient, clinic, hospital or admin
alike. Stores to S3 through the media-asset rail (stable /api/v1/media/<id>
URL, sha256-deduped); rows written before this rail still hold local
``/uploads/...`` URLs, which Flask keeps serving read-only.
"""
import os

from flask import Blueprint, current_app, request
from flask_jwt_extended import current_user, jwt_required

from app.common.responses import error_response, success_response
from app.extensions import db

media_bp = Blueprint('media', __name__)

_ALLOWED_IMG = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
_MAX_BYTES = 5 * 1024 * 1024  # 5 MB


@media_bp.route('/profile/image', methods=['POST'])
@jwt_required()
def upload_profile_image():
    """Upload + set the current user's profile picture. Multipart ``file``."""
    if 'file' not in request.files:
        return error_response('No file provided', status_code=400)
    f = request.files['file']
    if not f.filename:
        return error_response('Empty filename', status_code=400)

    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in _ALLOWED_IMG:
        return error_response(
            'Unsupported image type — use PNG, JPG, GIF or WebP.', status_code=400)

    # Size guard (seek to end to measure, then rewind).
    f.seek(0, os.SEEK_END)
    size = f.tell()
    f.seek(0)
    if size > _MAX_BYTES:
        return error_response('Image too large (max 5 MB).', status_code=400)

    # S3 via the media-asset rail: durable across container rebuilds and
    # reachable from every client. The stored value is the RELATIVE stable
    # path (/api/v1/media/<id>) — host-portable; web absolutizes it with
    # resolveMediaUrl, mobile prefixes its API base. Public access: profile
    # photos render on public booking/doctor cards. The old local-disk rail
    # (/uploads) remains served read-only for rows written before this.
    try:
        from app.services.s3_service import S3Service
        upload = S3Service.upload_file(
            f, 'profile_image', f.filename,
            is_private=False, folder='profile-images',
        )
    except ValueError as exc:  # type/size refusals from the shared rail
        return error_response(str(exc), status_code=400)
    except Exception:  # noqa: BLE001 — S3/creds outage
        current_app.logger.exception('[MEDIA] profile image upload failed')
        return error_response('Could not save image. Please try again.',
                              status_code=503)
    url = upload['media_url']

    # A profile picture is a self-service action for EVERY role (see the module
    # docstring) — set it directly so it's live immediately. Routing a doctor's
    # photo through the field-approval queue meant it stayed NULL on the User
    # until an admin approved it, so the patient-side booking cards/profile
    # showed the fallback icon instead of the doctor's uploaded photo. The photo
    # is low-risk content and was always documented as self-service; the other
    # approval-gated doctor fields are unaffected.
    current_user.profile_image = url
    db.session.commit()
    return success_response(data={'url': url}, message='Profile picture updated')
