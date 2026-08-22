"""
Appointment Validators
Input validation for appointment operations
"""
from datetime import datetime, date
from app.models import AppointmentType


class AppointmentValidator:
    """Validator class for appointment input data."""
    
    @staticmethod
    def validate_create(data):
        """Validate data for appointment creation."""
        errors = {}
        
        if not data.get('doctor_id'):
            errors['doctor_id'] = 'Doctor ID is required'
        
        if not data.get('appointment_date'):
            errors['appointment_date'] = 'Appointment date is required'
        else:
            if not AppointmentValidator._is_valid_date(data['appointment_date']):
                errors['appointment_date'] = 'Invalid date format. Use YYYY-MM-DD'
            elif not AppointmentValidator._is_future_date(data['appointment_date']):
                errors['appointment_date'] = 'Appointment date must be in the future'
        
        if not data.get('start_time'):
            errors['start_time'] = 'Start time is required'
        else:
            if not AppointmentValidator._is_valid_time(data['start_time']):
                errors['start_time'] = 'Invalid time format. Use HH:MM'
        
        if data.get('appointment_type'):
            if data['appointment_type'] not in [t.value for t in AppointmentType]:
                errors['appointment_type'] = f'Invalid type. Must be one of: {[t.value for t in AppointmentType]}'
        
        return errors
    
    @staticmethod
    def validate_reschedule(data):
        """Validate data for rescheduling."""
        errors = {}
        
        if not data.get('appointment_date'):
            errors['appointment_date'] = 'New date is required'
        else:
            if not AppointmentValidator._is_valid_date(data['appointment_date']):
                errors['appointment_date'] = 'Invalid date format'
            elif not AppointmentValidator._is_future_date(data['appointment_date']):
                errors['appointment_date'] = 'Date must be in the future'
        
        if not data.get('start_time'):
            errors['start_time'] = 'New time is required'
        else:
            if not AppointmentValidator._is_valid_time(data['start_time']):
                errors['start_time'] = 'Invalid time format'
        
        return errors
    
    @staticmethod
    def _is_valid_date(date_str):
        """Check if string is a valid date."""
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
            return True
        except ValueError:
            return False
    
    @staticmethod
    def _is_future_date(date_str):
        """Check if date is in the future."""
        try:
            parsed_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            return parsed_date > date.today()
        except ValueError:
            return False
    
    @staticmethod
    def _is_valid_time(time_str):
        """Check if string is a valid time."""
        try:
            datetime.strptime(time_str, '%H:%M')
            return True
        except ValueError:
            return False
