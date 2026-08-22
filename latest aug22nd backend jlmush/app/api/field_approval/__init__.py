"""
Field Approval Module
Handles field-level approval workflow for doctor/admin profile changes.
All profile field changes go through super admin approval before taking effect.
"""
from flask import Blueprint

field_approval_bp = Blueprint('field_approval', __name__)

from . import routes  # noqa
