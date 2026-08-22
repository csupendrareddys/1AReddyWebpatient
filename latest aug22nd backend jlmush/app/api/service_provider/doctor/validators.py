"""
Doctor Validators
Input validation for doctor-related operations
"""
from datetime import datetime
from app.models import Gender, ServiceName, AcceptingAppointmentType


class DoctorValidator:
    """Validator class for doctor input data."""
    
    @staticmethod
    def validate_create(data):
        """Validate data for doctor profile creation."""
        errors = {}
        
        # Required fields
        if not data.get('first_name'):
            errors['first_name'] = 'First name is required'
        
        if not data.get('last_name'):
            errors['last_name'] = 'Last name is required'
        
        if not data.get('registration_number'):
            errors['registration_number'] = 'Registration number is required'
        
        # Optional validations
        if data.get('gender'):
            if data['gender'] not in [g.value for g in Gender]:
                errors['gender'] = f'Invalid gender. Must be one of: {[g.value for g in Gender]}'
        
        if data.get('registration_year'):
            try:
                year = int(data['registration_year'])
                current_year = datetime.now().year
                if year < 1950 or year > current_year:
                    errors['registration_year'] = f'Registration year must be between 1950 and {current_year}'
            except ValueError:
                errors['registration_year'] = 'Registration year must be a number'
        
        if data.get('experience_years'):
            try:
                exp = int(data['experience_years'])
                if exp < 0 or exp > 70:
                    errors['experience_years'] = 'Experience years must be between 0 and 70'
            except ValueError:
                errors['experience_years'] = 'Experience years must be a number'
        
        if data.get('consultation_fee'):
            try:
                fee = float(data['consultation_fee'])
                if fee < 0:
                    errors['consultation_fee'] = 'Consultation fee cannot be negative'
            except ValueError:
                errors['consultation_fee'] = 'Consultation fee must be a number'
        
        return errors
    
    @staticmethod
    def validate_update(data):
        """Validate data for doctor profile update."""
        errors = {}
        
        # All fields are optional for update, just validate if present
        if data.get('gender'):
            if data['gender'] not in [g.value for g in Gender]:
                errors['gender'] = f'Invalid gender'
        
        if data.get('accepting_appointments'):
            if data['accepting_appointments'] not in [a.value for a in AcceptingAppointmentType]:
                errors['accepting_appointments'] = f'Invalid accepting_appointments value'
        
        return errors
    
    @staticmethod
    def validate_service(data):
        """Validate data for adding a doctor service."""
        errors = {}
        
        if not data.get('service_name'):
            errors['service_name'] = 'Service name is required'
        elif data['service_name'] not in [s.value for s in ServiceName]:
            errors['service_name'] = f'Invalid service name. Must be one of: {[s.value for s in ServiceName]}'
        
        if not data.get('price'):
            errors['price'] = 'Price is required'
        else:
            try:
                price = float(data['price'])
                if price < 0:
                    errors['price'] = 'Price cannot be negative'
            except ValueError:
                errors['price'] = 'Price must be a number'
        
        if data.get('duration_minutes'):
            try:
                duration = int(data['duration_minutes'])
                if duration <= 0:
                    errors['duration_minutes'] = 'Duration must be positive'
            except ValueError:
                errors['duration_minutes'] = 'Duration must be a number'
        
        return errors
    
    @staticmethod
    def validate_qualification(data):
        """Validate data for adding a qualification."""
        errors = {}
        
        if not data.get('degree_name'):
            errors['degree_name'] = 'Degree name is required'
        
        if not data.get('institution'):
            errors['institution'] = 'Institution is required'
        
        if data.get('passing_year'):
            try:
                year = int(data['passing_year'])
                current_year = datetime.now().year
                if year < 1950 or year > current_year:
                    errors['passing_year'] = f'Passing year must be between 1950 and {current_year}'
            except ValueError:
                errors['passing_year'] = 'Passing year must be a number'
        
        return errors
