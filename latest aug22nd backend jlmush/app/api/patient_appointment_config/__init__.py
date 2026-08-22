"""Patient Appointment Configuration API Blueprint."""
from flask import Blueprint

patient_appointment_config_bp = Blueprint('patient_appointment_config', __name__, url_prefix='/api/v1/patient-appointment-config')

from app.api.patient_appointment_config import routes
