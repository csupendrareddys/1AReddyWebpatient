"""What a signed-in provider staff member can ask about themselves.

Registered under ``/api/staff``. Distinct from ``/api/provider-staff``, which
is the practice OWNER managing the people who work for them — this is one of
those people, after they log in, asking "who am I and what may I touch?".

The dashboard is built entirely from ``/me``: a receptionist has no provider
row of their own, so every screen they see is derived from their staff record,
the practice it is anchored to, and the union of their roles' grants. Shipping
that as one response rather than four calls is deliberate — the client cannot
render a single menu item until it has all of it.
"""
from flask import Blueprint

staff_bp = Blueprint('staff', __name__)

from app.api.staff import routes  # noqa: E402,F401
