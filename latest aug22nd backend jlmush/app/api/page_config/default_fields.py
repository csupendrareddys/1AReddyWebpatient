"""Default field configurations for signup pages."""

# Patient Signup Fields
PATIENT_SIGNUP_FIELDS = [
    {"key": "first_name", "label": "First Name", "visible": True, "required": True, "order": 1, "type": "text"},
    {"key": "last_name", "label": "Last Name", "visible": True, "required": False, "order": 2, "type": "text"},
    {"key": "email", "label": "Email", "visible": True, "required": True, "order": 3, "type": "email"},
    {"key": "phone_number", "label": "Phone Number", "visible": True, "required": True, "order": 4, "type": "tel"},
    {"key": "state", "label": "State", "visible": True, "required": True, "order": 5, "type": "select"},
    {"key": "date_of_birth", "label": "Date of Birth", "visible": True, "required": False, "order": 6, "type": "date"},
    {"key": "gender", "label": "Gender", "visible": True, "required": False, "order": 7, "type": "select"},
    {"key": "aadhar_number", "label": "Aadhaar Number", "visible": False, "required": False, "order": 8, "type": "text"},
    {"key": "address", "label": "Address", "visible": False, "required": False, "order": 9, "type": "text"},
    {"key": "referral_code", "label": "Referral Code", "visible": False, "required": False, "order": 10, "type": "text"},
    {"key": "password", "label": "Password", "visible": True, "required": True, "order": 11, "type": "password"},
    {"key": "confirm_password", "label": "Confirm Password", "visible": True, "required": True, "order": 12, "type": "password"},
]

# Doctor Signup Fields
DOCTOR_SIGNUP_FIELDS = [
    {"key": "first_name", "label": "First Name", "visible": True, "required": True, "order": 1, "type": "text"},
    {"key": "last_name", "label": "Last Name", "visible": True, "required": False, "order": 2, "type": "text"},
    {"key": "email", "label": "Email", "visible": True, "required": True, "order": 3, "type": "email"},
    {"key": "phone_number", "label": "Phone Number", "visible": True, "required": True, "order": 4, "type": "tel"},
    {"key": "specialization", "label": "Specialization", "visible": True, "required": True, "order": 5, "type": "select"},
    {"key": "registration_number", "label": "Registration Number", "visible": True, "required": True, "order": 6, "type": "text"},
    {"key": "years_experience", "label": "Years of Experience", "visible": True, "required": False, "order": 7, "type": "number"},
    {"key": "clinic_address", "label": "Clinic Address", "visible": True, "required": False, "order": 8, "type": "text"},
    {"key": "qualifications", "label": "Qualifications", "visible": True, "required": True, "order": 9, "type": "dynamic"},
    {"key": "password", "label": "Password", "visible": True, "required": True, "order": 10, "type": "password"},
    {"key": "confirm_password", "label": "Confirm Password", "visible": True, "required": True, "order": 11, "type": "password"},
]

# Pharmacy Signup Fields
PHARMACY_SIGNUP_FIELDS = [
    {"key": "name", "label": "Pharmacy Name", "visible": True, "required": True, "order": 1, "type": "text"},
    {"key": "email", "label": "Email", "visible": True, "required": True, "order": 2, "type": "email"},
    {"key": "phone_number", "label": "Phone Number", "visible": True, "required": True, "order": 3, "type": "tel"},
    {"key": "license_number", "label": "License Number", "visible": True, "required": True, "order": 4, "type": "text"},
    {"key": "address", "label": "Address", "visible": True, "required": True, "order": 5, "type": "text"},
    {"key": "city", "label": "City", "visible": True, "required": True, "order": 6, "type": "text"},
    {"key": "state", "label": "State", "visible": True, "required": True, "order": 7, "type": "select"},
    {"key": "pincode", "label": "Pincode", "visible": True, "required": True, "order": 8, "type": "text"},
    {"key": "password", "label": "Password", "visible": True, "required": True, "order": 9, "type": "password"},
    {"key": "confirm_password", "label": "Confirm Password", "visible": True, "required": True, "order": 10, "type": "password"},
]

# Diagnosis Center Signup Fields
DIAGNOSIS_SIGNUP_FIELDS = [
    {"key": "name", "label": "Center Name", "visible": True, "required": True, "order": 1, "type": "text"},
    {"key": "email", "label": "Email", "visible": True, "required": True, "order": 2, "type": "email"},
    {"key": "phone_number", "label": "Phone Number", "visible": True, "required": True, "order": 3, "type": "tel"},
    {"key": "license_number", "label": "License Number", "visible": True, "required": True, "order": 4, "type": "text"},
    {"key": "address", "label": "Address", "visible": True, "required": True, "order": 5, "type": "text"},
    {"key": "city", "label": "City", "visible": True, "required": True, "order": 6, "type": "text"},
    {"key": "state", "label": "State", "visible": True, "required": True, "order": 7, "type": "select"},
    {"key": "pincode", "label": "Pincode", "visible": True, "required": True, "order": 8, "type": "text"},
    {"key": "password", "label": "Password", "visible": True, "required": True, "order": 9, "type": "password"},
    {"key": "confirm_password", "label": "Confirm Password", "visible": True, "required": True, "order": 10, "type": "password"},
]

# Patient Appointment Filter Fields (admin-controlled filters for doctor search)
PATIENT_APPOINTMENT_FILTER_FIELDS = [
    {
        "key": "languages", "label": "Languages", "visible": True, "order": 1,
        "type": "multi_select", "options": [
            "Assamese", "Bengali", "Gujarati", "Hindi", "Kannada", "Kashmiri",
            "Konkani", "Malayalam", "Marathi", "Oriya", "Punjabi", "Tamil",
            "Telugu", "Urdu", "English",
        ],
    },
    {
        "key": "specialization", "label": "Specializations", "visible": True, "order": 2,
        "type": "multi_select", "options_source": "specializations",
    },
    {
        "key": "experience", "label": "Experience", "visible": True, "order": 3,
        "type": "range", "min": 0, "max": 50, "unit": "years",
    },
    {
        "key": "gender", "label": "Gender", "visible": True, "order": 4,
        "type": "checkbox_group", "options": ["Male", "Female", "Others"],
    },
    {
        "key": "price_range", "label": "Price Range", "visible": True, "order": 5,
        "type": "range", "min": 200, "max": 2500, "unit": "INR",
    },
    {
        "key": "rating", "label": "Rating", "visible": True, "order": 6,
        "type": "range", "min": 1, "max": 5, "step": 1,
    },
    {
        "key": "category", "label": "Category of Doctors", "visible": False, "order": 7,
        "type": "multi_select", "options_source": "doctor_categories",
    },
]

# Patient Appointment Symptoms Fields (symptom selection sections)
PATIENT_APPOINTMENT_SYMPTOMS_FIELDS = [
    {
        "key": "body_symptoms", "label": "Symptoms", "visible": True, "order": 1,
        "type": "symptom_grid", "gender_grouped": True,
        "description": "Select symptoms by body area",
    },
    {
        "key": "specialization_symptoms", "label": "Specializations", "visible": True, "order": 2,
        "type": "specialization_grid",
        "description": "Select by medical specialization",
    },
]

# Mapping of page types to their default fields
DEFAULT_SIGNUP_FIELDS = {
    'patient_signup': PATIENT_SIGNUP_FIELDS,
    'doctor_signup': DOCTOR_SIGNUP_FIELDS,
    'pharmacy_signup': PHARMACY_SIGNUP_FIELDS,
    'diagnosis_signup': DIAGNOSIS_SIGNUP_FIELDS,
    'patient_appointment_filter': PATIENT_APPOINTMENT_FILTER_FIELDS,
    'patient_appointment_symptoms': PATIENT_APPOINTMENT_SYMPTOMS_FIELDS,
}


def get_default_fields(page_type: str) -> list:
    """Get default field configuration for a signup page type."""
    return DEFAULT_SIGNUP_FIELDS.get(page_type, [])
