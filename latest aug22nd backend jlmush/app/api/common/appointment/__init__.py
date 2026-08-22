"""
Appointment Module - Blueprint Registration
"""
from flask import Blueprint

appointment_bp = Blueprint('appointment', __name__)

# Import routes AFTER blueprint creation to avoid circular imports
from . import routes  # noqa
