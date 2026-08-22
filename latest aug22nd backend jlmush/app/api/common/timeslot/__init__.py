"""
TimeSlot Module
Manages concrete time-slot records and consultation-type mappings.
"""
from flask import Blueprint

timeslot_bp = Blueprint('timeslot', __name__)

from . import routes  # noqa
