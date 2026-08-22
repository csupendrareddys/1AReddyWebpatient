"""
Document file downloads — blueprint registration.

Mounted at ``/api/document-files``. One blueprint for all three audiences
(doctor, admin, patient) because the authorisation question is the same
one — "may this user see this document?" — and answering it in a single
place is safer than three near-copies drifting apart.
"""
from flask import Blueprint

document_files_bp = Blueprint('document_files', __name__)

from app.api.common.document_files import routes  # noqa: E402,F401
