"""
Affiliation blueprint — apex-marketplace doctor↔hospital roster management.

Surfaces two complementary audiences:

  * Doctor — generate/revoke an invite code, list their affiliation
    requests, accept/reject hospital invitations.
  * Hospital/Clinic admin (UserRole.HOSPITAL / UserRole.CLINIC) — claim a
    doctor via their invite code, directly create a brand-new doctor
    account onto their roster, list current roster + pending requests.

The lifecycle table is shared (``doctor_hospital_affiliations``); routes
just present different views on the same rows.
"""
from flask import Blueprint

affiliation_bp = Blueprint('affiliation', __name__)

# Routes import the blueprint, so register after creation
from . import routes  # noqa: E402,F401
