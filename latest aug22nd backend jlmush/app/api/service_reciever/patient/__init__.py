"""
Patient Module - Blueprint Registration
"""
from flask import Blueprint

patient_bp = Blueprint('patient', __name__)

from app.api.service_reciever.patient import routes  # noqa
from app.api.service_reciever.patient import group_offering_routes  # noqa

