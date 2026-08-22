"""In-app notification feed (any authenticated role).

  GET  /api/notifications            -> newest-first page + unread_count
  POST /api/notifications/<id>/read  -> mark one read
  POST /api/notifications/read-all   -> mark everything read

Recipient scoping is absolute: every query filters on the JWT user's id
within the request's tenant — there is no way to address another user's
feed. Socket delivery is a live-update hint only; this REST surface is
the source of truth the bell renders from.
"""
from flask import Blueprint

notifications_bp = Blueprint('notifications', __name__)

from app.api.notifications import routes  # noqa: E402,F401
