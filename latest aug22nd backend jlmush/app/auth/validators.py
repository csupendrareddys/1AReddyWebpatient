from marshmallow import Schema, fields, validate, validates, validates_schema, ValidationError, EXCLUDE
import re


# Legal-entity types (mirror app.models._enums.EntityType values). Kept as a
# plain list here to avoid importing the models layer into validators.
_ENTITY_TYPES = [
    'individual', 'proprietorship', 'partnership', 'private_limited',
    'public_limited', 'section_8', 'trust',
]


class EntityCoreSchema(Schema):
    """Core entity-details captured at corporate signup. Logos, document
    attachments and authorized-personnel are completed later in the profile,
    so only text fields live here."""
    class Meta:
        unknown = EXCLUDE

    entity_type = fields.Str(required=True, validate=validate.OneOf(_ENTITY_TYPES))
    entity_name = fields.Str(required=False, allow_none=True)
    legal_name = fields.Str(required=False, allow_none=True)
    trade_name = fields.Str(required=False, allow_none=True)
    promoters = fields.List(fields.Str(), required=False)
    year_of_establishment = fields.Int(required=False, allow_none=True)
    registration_license_number = fields.Str(required=False, allow_none=True)
    cin_number = fields.Str(required=False, allow_none=True)
    gst_number = fields.Str(required=False, allow_none=True)
    pan_number = fields.Str(required=False, allow_none=True)


class SignupSchemaPatient(Schema):
    """Validation schema for user signup with profile creation."""
    email = fields.Email(required=False)
    password = fields.Str(
        required=True,
        validate=validate.Length(min=8, max=128)
    )
    phone_number = fields.Str(
        required=True,
        validate=validate.Length(min=10, max=15)
    )
    first_name = fields.Str(
        required=True,
        validate=validate.Length(min=2, max=50)
    )
    last_name = fields.Str(
        required=False,
        validate=validate.Length(min=2, max=50)
    )
    role = fields.Str(
        required=True,
        validate=validate.OneOf(['patient']),
    )
    state = fields.Str(
        required=True,
        validate=validate.OneOf(['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'])
    )
    referral_code = fields.Str(
        required=False,
        validate=validate.Length(min=6, max=12)
    )
    # Phone OTP is mandatory pre-signup verification (Combirds SMS).
    phone_verification_token = fields.Str(required=True)
    # Email OTP is mandatory IFF an email was supplied — frontend submits
    # the token from /auth/pre-signup/verify-email-otp. The signup
    # service raises if the field is missing while ``email`` is set.
    email_verification_token = fields.Str(required=False, allow_none=True)
    # Per-tenant signup target. If absent the backend resolves from
    # X-Tenant-Slug header or falls back to the default tenant.
    tenant_slug = fields.Str(required=False, allow_none=True,
                             validate=validate.Length(max=100))
    # Optional marketplace (receiver) membership plan chosen at registration —
    # the plan's ``code``. When present, the signup mints the patient's
    # membership so the plan tag shows on their dashboard.
    plan_code = fields.Str(required=False, allow_none=True,
                           validate=validate.Length(max=100))

    # Individual vs corporate patient. ``corporate`` reveals the entity
    # sub-form; the core entity details ride along under ``entity``.
    account_type = fields.Str(
        required=False, load_default='individual',
        validate=validate.OneOf(['individual', 'corporate']),
    )
    entity = fields.Nested(EntityCoreSchema, required=False, allow_none=True)

    @validates('password')
    def validate_password(self, password, **kwargs):
        """Validate password strength."""
        if len(password) > 128:
            raise ValidationError('Password must not exceed 128 characters')
        if not re.search(r'[A-Z]', password):
            raise ValidationError('Password must contain at least one uppercase letter')
        if not re.search(r'[a-z]', password):
            raise ValidationError('Password must contain at least one lowercase letter')
        if not re.search(r'[0-9]', password):
            raise ValidationError('Password must contain at least one digit')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            raise ValidationError('Password must contain at least one special character')
        # Check for common passwords
        common_passwords = ['password', '12345678', 'qwerty123', 'abc12345', 'password1', 'Password1!']
        if password.lower().replace('!', '').replace('@', '').replace('1', '') in [p.lower() for p in common_passwords]:
            raise ValidationError('Password is too common. Please choose a stronger password')
    
    @validates('phone_number')
    def validate_phone(self, phone_number, **kwargs):
        """Validate phone number format (Indian format)."""
        # Remove any spaces, dashes, or country code prefix
        clean_number = re.sub(r'[\s\-]', '', phone_number)
        # Remove +91 or 91 prefix if present
        if clean_number.startswith('+91'):
            clean_number = clean_number[3:]
        elif clean_number.startswith('91') and len(clean_number) == 12:
            clean_number = clean_number[2:]
        
        # Indian phone number validation: 10 digits starting with 6-9
        pattern = r'^[6-9]\d{9}$'
        if not re.match(pattern, clean_number):
            raise ValidationError('Invalid phone number. Must be a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9')
    
    @validates('email')
    def validate_email_format(self, email, **kwargs):
        """Additional email validation."""
        email = email.lower().strip()
        # Check for common typos in email domains
        if email.endswith('.con') or email.endswith('.cm') or email.endswith('.co'):
            raise ValidationError('Email domain looks incorrect. Did you mean .com?')
        if email.endswith('.orgg') or email.endswith('.og'):
            raise ValidationError('Email domain looks incorrect. Did you mean .org?')
        # Check minimum length for email
        if len(email) < 5:
            raise ValidationError('Email is too short')
        # Check for valid TLD
        valid_tlds = ['.com', '.org', '.net', '.edu', '.gov', '.in', '.co.in', '.io', '.info', '.biz']
        has_valid_tld = any(email.endswith(tld) for tld in valid_tlds)
        if not has_valid_tld and '.' in email.split('@')[-1]:
            # Allow other TLDs but check length
            tld = '.' + email.split('.')[-1]
            if len(tld) < 2 or len(tld) > 10:
                raise ValidationError('Invalid email domain')
    
    @validates('first_name')
    def validate_first_name(self, first_name, **kwargs):
        """Validate first name format."""
        # Only alphabets and spaces allowed
        if not re.match(r'^[a-zA-Z\s]+$', first_name):
            raise ValidationError('First name can only contain letters and spaces')
        # No leading or trailing spaces
        if first_name != first_name.strip():
            raise ValidationError('First name cannot have leading or trailing spaces')
        # No consecutive spaces
        if '  ' in first_name:
            raise ValidationError('First name cannot have consecutive spaces')
    
    @validates('last_name')
    def validate_last_name(self, last_name, **kwargs):
        """Validate last name format."""
        # Only alphabets and spaces allowed
        if not re.match(r'^[a-zA-Z\s]+$', last_name):
            raise ValidationError('Last name can only contain letters and spaces')
        # No leading or trailing spaces
        if last_name != last_name.strip():
            raise ValidationError('Last name cannot have leading or trailing spaces')
        # No consecutive spaces
        if '  ' in last_name:
            raise ValidationError('Last name cannot have consecutive spaces')
    

# Indian states list for validation
INDIAN_STATES = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
    'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra',
    'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
]


class QualificationSchema(Schema):
    """Schema for a single qualification entry."""
    degree_name = fields.Str(required=True, validate=validate.Length(min=2, max=200))
    institution = fields.Str(required=True, validate=validate.Length(min=2, max=300))

    # Round 5 — level-aware master-data references. The signup form now
    # sends ids alongside the human-readable names so the backend can
    # link the doctor row to the master_colleges / categories rows
    # without a fuzzy name match. All optional (older frontend builds
    # only sent the two ``*_name`` fields above).
    qualification_level = fields.Str(
        required=False, allow_none=True,
        validate=validate.OneOf(['ug', 'pg', 'super_speciality']),
    )
    degree_id = fields.Str(required=False, allow_none=True)
    specialization_id = fields.Str(required=False, allow_none=True)
    specialization_name = fields.Str(required=False, allow_none=True)
    college_id = fields.Str(required=False, allow_none=True)
    year_of_passing = fields.Str(required=False, allow_none=True)


class SignupSchemaDoctor(Schema):
    """Validation schema for doctor signup with profile creation."""
    # Personal details
    email = fields.Email(required=True)
    password = fields.Str(required=True, validate=validate.Length(min=8, max=128))
    phone_number = fields.Str(required=True, validate=validate.Length(min=10, max=15))
    first_name = fields.Str(required=True, validate=validate.Length(min=2, max=50))
    last_name = fields.Str(
        required=False,
        allow_none=True,
        validate=lambda x: x == "" or 2 <= len(x) <= 50
    )

    referral_code = fields.Str(
        required=False,
        allow_none=True,
        validate=lambda x: x == "" or 6 <= len(x) <= 12
    )
    # Phone OTP is mandatory pre-signup verification (Combirds SMS).
    phone_verification_token = fields.Str(required=True)
    # Email OTP is mandatory for doctor signup (email is required field).
    # Frontend submits the token from /auth/pre-signup/verify-email-otp.
    email_verification_token = fields.Str(required=True)

    # State - required
    state = fields.Str(required=True, validate=validate.OneOf(INDIAN_STATES))

    # Aadhaar details
    aadhar_number = fields.Str(required=True, validate=validate.Length(equal=12))

    # Professional details
    registration_number = fields.Str(required=True, validate=validate.Length(min=4, max=100))

    # Role (fixed as doctor)
    role = fields.Str(required=True, validate=validate.OneOf(['doctor']))

    # Qualifications list
    qualifications = fields.List(fields.Nested(QualificationSchema), required=True, validate=validate.Length(min=1))

    # Round 5 — apex marketplace plan selection. The route layer reads
    # ``plan_code`` from the form (set when the signup came through the
    # /join funnel) and runs ``_assert_marketplace_plan_required``
    # before the User row is written. Without these declarations
    # Marshmallow raised "Unknown field" and the plan-code never
    # reached the route's gate.
    plan_code = fields.Str(required=False, allow_none=True)
    # Round 5 — in-tenant provider plan selection (non-apex tenants).
    # Same pattern as ``plan_code`` but routes through the tenant's
    # own ``TenantProviderPlan`` catalog. Optional; backend decides
    # which of the two to honor based on tenant kind.
    tenant_provider_plan_id = fields.Str(required=False, allow_none=True)

    @validates_schema
    def validate_qualification_dependencies(self, data, **kwargs):
        """Enforce the education ladder on the qualification list.

        A doctor cannot claim a higher qualification without the ones
        beneath it:
          * PG               → requires a UG entry.
          * super_speciality → requires both PG and UG entries.

        Only fires when ``qualification_level`` is actually supplied on the
        entries (older frontend builds that omit the level are left alone).
        """
        quals = data.get('qualifications') or []
        levels = {
            (q.get('qualification_level') or '').strip().lower()
            for q in quals
        }
        levels.discard('')

        if 'super_speciality' in levels:
            missing = [lvl for lvl in ('ug', 'pg') if lvl not in levels]
            if missing:
                pretty = ' and '.join(m.upper() for m in missing)
                raise ValidationError(
                    {'qualifications': (
                        f'A super-speciality qualification requires both UG '
                        f'and PG qualifications. Missing: {pretty}.'
                    )}
                )
        elif 'pg' in levels and 'ug' not in levels:
            raise ValidationError(
                {'qualifications': (
                    'A PG qualification requires a UG qualification. '
                    'Please add your UG qualification.'
                )}
            )

    @validates('password')
    def validate_password(self, password, **kwargs):
        """Validate password strength."""
        if len(password) > 128:
            raise ValidationError('Password must not exceed 128 characters')
        if not re.search(r'[A-Z]', password):
            raise ValidationError('Password must contain at least one uppercase letter')
        if not re.search(r'[a-z]', password):
            raise ValidationError('Password must contain at least one lowercase letter')
        if not re.search(r'[0-9]', password):
            raise ValidationError('Password must contain at least one digit')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            raise ValidationError('Password must contain at least one special character')
    
    @validates('phone_number')
    def validate_phone(self, phone_number, **kwargs):
        """Validate phone number format (Indian format)."""
        clean_number = re.sub(r'[\s\-]', '', phone_number)
        if clean_number.startswith('+91'):
            clean_number = clean_number[3:]
        elif clean_number.startswith('91') and len(clean_number) == 12:
            clean_number = clean_number[2:]
        
        pattern = r'^[6-9]\d{9}$'
        if not re.match(pattern, clean_number):
            raise ValidationError('Invalid phone number. Must be a valid 10-digit Indian mobile number')
    
    @validates('aadhar_number')
    def validate_aadhar(self, aadhar_number, **kwargs):
        """Validate Aadhaar number format (12 digits, starts with 2-9)."""
        if not re.match(r'^[2-9]\d{11}$', aadhar_number):
            raise ValidationError('Invalid Aadhaar number. Must be 12 digits starting with 2-9')
    
    @validates('first_name')
    def validate_first_name(self, first_name, **kwargs):
        """Validate first name format."""
        if not re.match(r'^[a-zA-Z\s]+$', first_name):
            raise ValidationError('First name can only contain letters and spaces')
        if first_name != first_name.strip():
            raise ValidationError('First name cannot have leading or trailing spaces')


class LoginSchema(Schema):
    """Validation schema for user login."""
    class Meta:
        unknown = EXCLUDE  # Ignore unexpected fields from frontend

    email = fields.Email(required=False)
    phone_number = fields.Str(required=False, validate=validate.Length(min=10, max=15))
    aadhar_number = fields.Str(required=False, validate=validate.Length(equal=12))
    password = fields.Str(required=True, validate=validate.Length(min=1))
    expected_role = fields.Str(required=False, validate=validate.OneOf([
        'patient', 'doctor', 'admin', 'super_admin', 'sub_admin',
        'platform_owner', 'service_provider', 'service_receiver',
    ]))
    # Tenant slug — when present, the user lookup is scoped to that
    # tenant. Same email/phone can exist in multiple tenants since
    # uniqueness is enforced per-tenant.
    tenant_slug = fields.Str(required=False, allow_none=True,
                             validate=validate.Length(max=100))
    device_info = fields.Dict(required=False)
    
    @validates('aadhar_number')
    def validate_aadhar(self, aadhar_number, **kwargs):
        """Validate Aadhaar number format (12 digits)."""
        if aadhar_number:
            # Remove any spaces
            clean_aadhar = aadhar_number.replace(' ', '')
            
            # Must be exactly 12 digits
            if not re.match(r'^\d{12}$', clean_aadhar):
                raise ValidationError('Aadhaar number must be exactly 12 digits')
            
            # First digit cannot be 0 or 1
            if clean_aadhar[0] in ('0', '1'):
                raise ValidationError('Invalid Aadhaar number format')
    
    @validates_schema
    def validate_login_identifier(self, data, **kwargs):
        """Ensure at least one login identifier is provided."""
        email = data.get('email')
        phone_number = data.get('phone_number')
        aadhar_number = data.get('aadhar_number')
        
        if not any([email, phone_number, aadhar_number]):
            raise ValidationError(
                'At least one of email, phone_number, or aadhar_number is required',
                field_name='_schema'
            )


class ForgotPasswordSchema(Schema):
    """Validation schema for forgot password."""
    email = fields.Email(required=False)
    phone_number = fields.Str(required=False, validate=validate.Length(min=10, max=15))
    aadhar_number = fields.Str(required=False, validate=validate.Length(equal=12))
    
    @validates('aadhar_number')
    def validate_aadhar(self, aadhar_number, **kwargs):
        """Validate Aadhaar number format (12 digits)."""
        if aadhar_number:
            # Remove any spaces
            clean_aadhar = aadhar_number.replace(' ', '')
            
            # Must be exactly 12 digits
            if not re.match(r'^\d{12}$', clean_aadhar):
                raise ValidationError('Aadhaar number must be exactly 12 digits')
            
            # First digit cannot be 0 or 1
            if clean_aadhar[0] in ('0', '1'):
                raise ValidationError('Invalid Aadhaar number format')
    
    @validates_schema
    def validate_forgot_password_identifier(self, data, **kwargs):
        """Ensure at least one forgot password identifier is provided."""
        email = data.get('email')
        phone_number = data.get('phone_number')
        aadhar_number = data.get('aadhar_number')
        
        if not any([email, phone_number, aadhar_number]):
            raise ValidationError(
                'At least one of email, phone_number, or aadhar_number is required',
                field_name='_schema'
            )

class ResetPasswordSchema(Schema):
    """Validation schema for password reset."""
    token = fields.Str(required=True, validate=validate.Length(min=1))
    new_password = fields.Str(
        required=True,
        validate=validate.Length(min=8, max=128)
    )
    confirm_password = fields.Str(
        required=True,
        validate=validate.Length(min=8, max=128)
    )
    
    @validates_schema
    def validate_passwords_match(self, data, **kwargs):
        """Ensure new password and confirm password match."""
        if data.get('new_password') != data.get('confirm_password'):
            raise ValidationError('Passwords do not match', field_name='confirm_password')
    
    @validates('new_password')
    def validate_password(self, password, **kwargs):
        """Validate password strength."""
        if not re.search(r'[A-Z]', password):
            raise ValidationError('Password must contain at least one uppercase letter')
        if not re.search(r'[a-z]', password):
            raise ValidationError('Password must contain at least one lowercase letter')
        if not re.search(r'[0-9]', password):
            raise ValidationError('Password must contain at least one digit')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            raise ValidationError('Password must contain at least one special character')


class ChangePasswordSchema(Schema):
    """Validation schema for password change."""
    current_password = fields.Str(required=True, validate=validate.Length(min=1))
    new_password = fields.Str(
        required=True,
        validate=validate.Length(min=8, max=128)
    )
    confirm_password = fields.Str(
        required=True,
        validate=validate.Length(min=8, max=128)
    )
    
    @validates_schema
    def validate_passwords_match(self, data, **kwargs):
        """Ensure new password and confirm password match."""
        if data.get('new_password') != data.get('confirm_password'):
            raise ValidationError('Passwords do not match', field_name='confirm_password')
        
        # Ensure new password is different from current password
        if data.get('current_password') == data.get('new_password'):
            raise ValidationError('New password must be different from current password', field_name='new_password')
    
    @validates('new_password')
    def validate_password(self, password, **kwargs):
        """Validate password strength."""
        if not re.search(r'[A-Z]', password):
            raise ValidationError('Password must contain at least one uppercase letter')
        if not re.search(r'[a-z]', password):
            raise ValidationError('Password must contain at least one lowercase letter')
        if not re.search(r'[0-9]', password):
            raise ValidationError('Password must contain at least one digit')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            raise ValidationError('Password must contain at least one special character')


class UpdateProfileSchema(Schema):
    """Validation schema for profile updates."""
    first_name = fields.Str(
        required=False,
        validate=validate.Length(min=1, max=150)
    )
    last_name = fields.Str(
        required=False,
        validate=validate.Length(min=1, max=150)
    )
    middle_name = fields.Str(
        required=False,
        validate=validate.Length(max=100),
        allow_none=True
    )
    phone_number = fields.Str(
        required=False,
        validate=validate.Length(min=10, max=15)
    )
    city = fields.Str(
        required=False,
        validate=validate.Length(min=1, max=100)
    )
    pincode = fields.Str(
        required=False,
        validate=validate.Length(min=6, max=10)
    )
    address = fields.Str(
        required=False,
        validate=validate.Length(min=1, max=500)
    )
    
    @validates('phone_number')
    def validate_phone(self, phone_number, **kwargs):
        """Validate phone number format (Indian format)."""
        if phone_number:
            # Remove any spaces or dashes
            clean_number = re.sub(r'[\s-]', '', phone_number)
            
            # Indian phone number validation
            pattern = r'^[6-9]\d{9}'
            if not re.match(pattern, clean_number):
                raise ValidationError('Invalid phone number format. Must be a valid 10-digit Indian phone number starting with 6-9.')
    
    @validates('pincode')
    def validate_pincode(self, pincode, **kwargs):
        """Validate Indian pincode format."""
        if pincode:
            # Indian pincode is 6 digits
            pattern = r'^\d{6}'
            if not re.match(pattern, pincode):
                raise ValidationError('Invalid pincode format. Must be a 6-digit number.')


class EmailSchema(Schema):
    """Simple email validation schema."""
    email = fields.Email(required=True)


class TokenSchema(Schema):
    """Token validation schema."""
    token = fields.Str(required=True, validate=validate.Length(min=1))


""" # Additional validators for specific use cases

def validate_username_availability(username: str) -> bool:
    
    # Check if username is available.
    # Can be used in custom validators.
   
    from app.models import User
    return not User.query.filter_by(username=username, is_deleted=False).first() """


def validate_email_availability(email: str) -> bool:
    """
    Check if email is available.
    Can be used in custom validators.
    """
    from app.models import User
    return not User.query.filter_by(email=email.lower(), is_deleted=False).first()


def validate_phone_availability(phone_number: str) -> bool:
    """
    Check if phone number is available.
    Can be used in custom validators.
    """
    from app.models import User
    return not User.query.filter_by(phone_number=phone_number, is_deleted=False).first()


def validate_password_strength(password: str) -> tuple[bool, list[str]]:
    """
    Comprehensive password strength validation.
    Returns (is_valid, list_of_errors)
    """
    errors = []
    
    if len(password) < 8:
        errors.append('Password must be at least 8 characters long')
    
    if len(password) > 128:
        errors.append('Password must not exceed 128 characters')
    
    if not re.search(r'[A-Z]', password):
        errors.append('Password must contain at least one uppercase letter')
    
    if not re.search(r'[a-z]', password):
        errors.append('Password must contain at least one lowercase letter')
    
    if not re.search(r'[0-9]', password):
        errors.append('Password must contain at least one digit')
    
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        errors.append('Password must contain at least one special character')
    
    # Check for common patterns
    common_passwords = ['password', '12345678', 'qwerty', 'abc123', 'password123']
    if password.lower() in common_passwords:
        errors.append('Password is too common. Please choose a stronger password')
    
    # Check for sequential characters
    if re.search(r'(012|123|234|345|456|567|678|789|890|abc|bcd|cde|def)', password.lower()):
        errors.append('Password contains sequential characters. Please choose a stronger password')
    
    return (len(errors) == 0, errors)


def sanitize_input(value: str, max_length: int = None) -> str:
    """
    Sanitize user input by removing potentially harmful characters.
    """
    if not value:
        return value
    
    # Remove leading/trailing whitespace
    value = value.strip()
    
    # Remove null bytes
    value = value.replace('\x00', '')
    
    # Truncate if max_length provided
    if max_length:
        value = value[:max_length]
    
    return value