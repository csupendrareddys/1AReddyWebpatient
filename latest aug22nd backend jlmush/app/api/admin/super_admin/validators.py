"""
Super Admin Validators
Validation schemas for admin management operations.
"""
import re
from marshmallow import Schema, fields, validate, validates, ValidationError


class CreateAdminSchema(Schema):
    """Schema for creating a new admin."""
    
    email = fields.Email(
        required=False,
        allow_none=True,
        error_messages={'invalid': 'Invalid email format'}
    )
    phone_number = fields.String(
        required=True,
        validate=validate.Regexp(
            r'^[6-9]\d{9}$',
            error='Phone number must be 10 digits starting with 6-9'
        )
    )
    password = fields.String(
        required=True,
        validate=validate.Length(min=8, max=128),
        load_only=True
    )
    first_name = fields.String(
        required=True,
        validate=validate.Length(min=1, max=100)
    )
    middle_name = fields.String(
        required=False,
        allow_none=True,
        validate=validate.Length(max=100)
    )
    last_name = fields.String(
        required=True,
        validate=validate.Length(min=1, max=100)
    )
    role = fields.String(
        required=False,
        validate=validate.OneOf(['super_admin', 'sub_admin']),
        load_default='sub_admin'
    )
    permissions = fields.List(
        fields.String(),
        required=False,
        load_default=list
    )
    
    @validates('password')
    def validate_password_strength(self, value, **kwargs):
        """Validate password strength."""
        errors = []
        
        if not re.search(r'[A-Z]', value):
            errors.append('Must contain at least one uppercase letter')
        if not re.search(r'[a-z]', value):
            errors.append('Must contain at least one lowercase letter')
        if not re.search(r'\d', value):
            errors.append('Must contain at least one digit')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', value):
            errors.append('Must contain at least one special character')
        
        if errors:
            raise ValidationError(errors)



class UpdateAdminSchema(Schema):
    """Schema for updating an admin."""
    
    first_name = fields.String(
        required=False,
        validate=validate.Length(min=1, max=100)
    )
    middle_name = fields.String(
        required=False,
        allow_none=True,
        validate=validate.Length(max=100)
    )
    last_name = fields.String(
        required=False,
        validate=validate.Length(min=1, max=100)
    )
    permissions = fields.List(
        fields.String(),
        required=False
    )


class AdminStatusSchema(Schema):
    """Schema for updating admin status."""
    
    status = fields.String(
        required=True,
        validate=validate.OneOf(['active', 'blocked', 'inactive'])
    )
