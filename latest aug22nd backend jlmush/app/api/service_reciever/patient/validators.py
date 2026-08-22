"""
Patient Validators
Input validation for patient-related operations
"""
from datetime import datetime
from app.models import Gender, BloodGroup


class PatientValidator:
    """Validator class for patient input data."""
    
    @staticmethod
    def validate_create(data):
        """
        Validate data for patient profile creation.
        
        Args:
            data: Dictionary containing patient data
        
        Returns:
            Dictionary of field errors (empty if valid)
        """
        errors = {}
        
        # Required fields
        if not data.get('first_name'):
            errors['first_name'] = 'First name is required'
        elif len(data['first_name']) > 100:
            errors['first_name'] = 'First name must be 100 characters or less'
        
        if not data.get('last_name'):
            errors['last_name'] = 'Last name is required'
        elif len(data['last_name']) > 100:
            errors['last_name'] = 'Last name must be 100 characters or less'
        
        # Optional field validations
        if data.get('middle_name') and len(data['middle_name']) > 100:
            errors['middle_name'] = 'Middle name must be 100 characters or less'
        
        if data.get('gender'):
            if not PatientValidator._is_valid_enum(data['gender'], Gender):
                errors['gender'] = f'Invalid gender. Must be one of: {[g.value for g in Gender]}'
        
        if data.get('blood_group'):
            if not PatientValidator._is_valid_enum(data['blood_group'], BloodGroup):
                errors['blood_group'] = f'Invalid blood group. Must be one of: {[b.value for b in BloodGroup]}'
        
        if data.get('dob'):
            if not PatientValidator._is_valid_date(data['dob']):
                errors['dob'] = 'Invalid date format. Use YYYY-MM-DD'
        
        if data.get('emergency_contact_phone'):
            if not PatientValidator._is_valid_phone(data['emergency_contact_phone']):
                errors['emergency_contact_phone'] = 'Invalid phone number format'
        
        return errors
    
    @staticmethod
    def validate_update(data):
        """
        Validate data for patient profile update.
        
        Args:
            data: Dictionary containing updated patient data
        
        Returns:
            Dictionary of field errors (empty if valid)
        """
        errors = {}
        
        # Same validations as create but all fields are optional
        if data.get('first_name') and len(data['first_name']) > 100:
            errors['first_name'] = 'First name must be 100 characters or less'
        
        if data.get('last_name') and len(data['last_name']) > 100:
            errors['last_name'] = 'Last name must be 100 characters or less'
        
        if data.get('middle_name') and len(data['middle_name']) > 100:
            errors['middle_name'] = 'Middle name must be 100 characters or less'
        
        if data.get('gender'):
            if not PatientValidator._is_valid_enum(data['gender'], Gender):
                errors['gender'] = f'Invalid gender. Must be one of: {[g.value for g in Gender]}'
        
        if data.get('blood_group'):
            if not PatientValidator._is_valid_enum(data['blood_group'], BloodGroup):
                errors['blood_group'] = f'Invalid blood group. Must be one of: {[b.value for b in BloodGroup]}'
        
        if data.get('dob'):
            if not PatientValidator._is_valid_date(data['dob']):
                errors['dob'] = 'Invalid date format. Use YYYY-MM-DD'
        
        if data.get('emergency_contact_phone'):
            if not PatientValidator._is_valid_phone(data['emergency_contact_phone']):
                errors['emergency_contact_phone'] = 'Invalid phone number format'
        
        return errors
    
    @staticmethod
    def _is_valid_enum(value, enum_class):
        """Check if value is a valid enum member."""
        try:
            return value in [e.value for e in enum_class]
        except:
            return False
    
    @staticmethod
    def _is_valid_date(date_str):
        """Check if string is a valid date in YYYY-MM-DD format."""
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
            return True
        except ValueError:
            return False
    
    @staticmethod
    def _is_valid_phone(phone):
        """Check if phone number is valid (basic validation)."""
        # Remove common formatting characters
        clean_phone = ''.join(c for c in phone if c.isdigit())
        return 10 <= len(clean_phone) <= 15
