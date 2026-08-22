"""
Default sections and field definitions for the Patient Profile page configuration.

Mirrors the doctor profile config structure:
    - PATIENT_PROFILE_SECTIONS: section-level metadata (label, order, visibility)
    - PATIENT_PROFILE_FIELDS: field-level metadata keyed by section
"""

# ─────────────────────────────────────────────────────────────────────────────
# Section Definitions (stored as PageConfig.fields JSON)
# ─────────────────────────────────────────────────────────────────────────────

PATIENT_PROFILE_SECTIONS = [
    {
        "key": "personal_details",
        "label": "Personal Details",
        "display_order": 1,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "व्यक्तिगत विवरण", "te": "వ్యక్తిగత వివరాలు"},
    },
    {
        "key": "contact_identity",
        "label": "Contact & Identity",
        "display_order": 2,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "संपर्क और पहचान", "te": "సంప్రదింపు & గుర్తింపు"},
    },
    {
        "key": "address",
        "label": "Address",
        "display_order": 3,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "पता", "te": "చిరునామా"},
    },
    {
        "key": "emergency_contact",
        "label": "Emergency Contact",
        "display_order": 4,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "आपातकालीन संपर्क", "te": "అత్యవసర సంప్రదింపు"},
    },
    {
        "key": "insurance",
        "label": "Insurance Details",
        "display_order": 5,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "बीमा विवरण", "te": "బీమా వివరాలు"},
    },
    {
        "key": "female_health",
        "label": "Female Health",
        "display_order": 6,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "महिला स्वास्थ्य", "te": "మహిళా ఆరోగ్యం"},
    },
    {
        "key": "vitals",
        "label": "Vitals",
        "display_order": 7,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "जीवन संकेत", "te": "ప్రాణ సంకేతాలు"},
    },
    {
        "key": "habits",
        "label": "Habits & Lifestyle",
        "display_order": 8,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "आदतें और जीवनशैली", "te": "అలవాట్లు & జీవనశైలి"},
    },
    {
        "key": "surgeries",
        "label": "Surgeries",
        "display_order": 9,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "सर्जरी", "te": "శస్త్రచికిత్సలు"},
    },
    {
        "key": "health_records",
        "label": "Health Records",
        "display_order": 10,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "स्वास्थ्य रिकॉर्ड", "te": "ఆరోగ్య రికార్డులు"},
    },
    {
        "key": "previous_prescriptions",
        "label": "Previous Prescriptions",
        "display_order": 11,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "पिछले नुस्खे", "te": "మునుపటి ప్రిస్క్రిప్షన్లు"},
    },
    {
        "key": "house_family_group",
        "label": "House / Family Group",
        "display_order": 12,
        "is_present": True,
        "user_types": None,
        "translations": {"hi": "घर / परिवार समूह", "te": "ఇల్లు / కుటుంబ సమూహం"},
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# Field Definitions (stored as PatientProfileFieldConfig rows)
# ─────────────────────────────────────────────────────────────────────────────

def _address_fields(prefix=""):
    """Reusable address field set."""
    p = f"{prefix}_" if prefix else ""
    return [
        {"field_key": f"{p}address_line1", "field_type": "text", "label": "Address Line 1", "placeholder": "House/Flat No., Street", "required": True, "display_order": 1, "max_length": 300},
        {"field_key": f"{p}address_line2", "field_type": "text", "label": "Address Line 2", "placeholder": "Landmark, Area", "required": False, "display_order": 2, "max_length": 300},
        {"field_key": f"{p}city", "field_type": "text", "label": "City / Town", "placeholder": "Enter city", "required": True, "display_order": 3, "max_length": 100},
        {"field_key": f"{p}state", "field_type": "select", "label": "State", "required": True, "display_order": 4, "data_source": "master_states"},
        {"field_key": f"{p}pincode", "field_type": "text", "label": "PIN Code", "placeholder": "6-digit PIN", "required": True, "display_order": 5, "max_length": 6, "min_length": 6, "validation_regex": r"^\d{6}$", "validation_message": "Enter a valid 6-digit PIN code"},
        {"field_key": f"{p}country", "field_type": "text", "label": "Country", "required": False, "display_order": 6, "max_length": 100},
    ]


PATIENT_PROFILE_FIELDS = {
    # ── Personal Details ──────────────────────────────────────────
    "personal_details": [
        {"field_key": "first_name", "field_type": "text", "label": "First Name", "placeholder": "Enter first name", "required": True, "display_order": 1, "min_length": 1, "max_length": 100},
        {"field_key": "middle_name", "field_type": "text", "label": "Middle Name", "placeholder": "Enter middle name", "required": False, "display_order": 2, "max_length": 100},
        {"field_key": "last_name", "field_type": "text", "label": "Last Name", "placeholder": "Enter last name", "required": True, "display_order": 3, "min_length": 1, "max_length": 100},
        {"field_key": "dob", "field_type": "date", "label": "Date of Birth", "required": True, "display_order": 4},
        {"field_key": "gender", "field_type": "select", "label": "Gender", "required": True, "display_order": 5, "data_source": "gender_options"},
        {"field_key": "blood_group", "field_type": "select", "label": "Blood Group", "required": False, "display_order": 6, "data_source": "blood_groups"},
        {"field_key": "languages_known", "field_type": "multi_select", "label": "Languages Known", "placeholder": "Select languages", "required": False, "display_order": 7, "data_source": "indian_languages"},
        {"field_key": "profile_image", "field_type": "file", "label": "Profile Photo", "required": False, "display_order": 8},
    ],

    # ── Contact & Identity ─────────────────────────────────────────
    "contact_identity": [
        {"field_key": "phone_number", "field_type": "tel", "label": "Phone Number", "placeholder": "+91 XXXXX XXXXX", "required": True, "display_order": 1, "helper_text": "Verified via OTP"},
        {"field_key": "alternative_phone", "field_type": "tel", "label": "Alternative Phone", "placeholder": "+91 XXXXX XXXXX", "required": False, "display_order": 2},
        {"field_key": "email", "field_type": "email", "label": "Email Address", "placeholder": "your@email.com", "required": False, "display_order": 3},
        {"field_key": "alternative_email", "field_type": "email", "label": "Alternative Email", "required": False, "display_order": 4},
        {"field_key": "aadhar_number", "field_type": "text", "label": "Aadhaar Number", "placeholder": "XXXX XXXX XXXX", "required": False, "display_order": 5, "max_length": 12, "min_length": 12, "validation_regex": r"^\d{12}$", "validation_message": "Enter a valid 12-digit Aadhaar number"},
        {"field_key": "pan_number", "field_type": "text", "label": "PAN Number", "placeholder": "ABCDE1234F", "required": False, "display_order": 6, "max_length": 10, "min_length": 10, "validation_regex": r"^[A-Z]{5}[0-9]{4}[A-Z]$", "validation_message": "Enter a valid PAN (e.g. ABCDE1234F)"},
        {"field_key": "religion", "field_type": "select", "label": "Religion", "required": False, "display_order": 7, "data_source": "master_religions"},
        {"field_key": "caste", "field_type": "select", "label": "Caste / Category", "required": False, "display_order": 8, "data_source": "master_categories"},
        {"field_key": "citizenship", "field_type": "text", "label": "Citizenship", "required": False, "display_order": 9, "max_length": 50},
    ],

    # ── Address ───────────────────────────────────────────────────
    "address": _address_fields(),

    # ── Emergency Contact ──────────────────────────────────────────
    "emergency_contact": [
        {"field_key": "emergency_contact_name", "field_type": "text", "label": "Contact Name", "placeholder": "Full name", "required": True, "display_order": 1, "max_length": 200},
        {"field_key": "emergency_contact_phone", "field_type": "tel", "label": "Contact Phone", "placeholder": "+91 XXXXX XXXXX", "required": True, "display_order": 2},
        {"field_key": "emergency_contact_relation", "field_type": "select", "label": "Relation", "required": True, "display_order": 3, "data_source": "relation_types"},
        {"field_key": "emergency_contact_email", "field_type": "email", "label": "Contact Email", "required": False, "display_order": 4},
    ],

    # ── Insurance ──────────────────────────────────────────────────
    "insurance": [
        {"field_key": "insurance_provider", "field_type": "select", "label": "Insurance Provider", "required": False, "display_order": 1, "data_source": "insurance_providers"},
        {"field_key": "insurance_policy_number", "field_type": "text", "label": "Policy Number", "placeholder": "Enter policy number", "required": False, "display_order": 2, "max_length": 100},
        {"field_key": "insurance_valid_till", "field_type": "date", "label": "Valid Till", "required": False, "display_order": 3},
        {"field_key": "insurance_coverage_amount", "field_type": "number", "label": "Coverage Amount (INR)", "required": False, "display_order": 4},
    ],

    # ── Female Health ──────────────────────────────────────────────
    "female_health": [
        {"field_key": "lmp_date", "field_type": "date", "label": "Last Menstrual Period (LMP)", "required": False, "display_order": 1, "helper_text": "Date of last period"},
        {"field_key": "lmp_remarks", "field_type": "textarea", "label": "LMP Remarks", "required": False, "display_order": 2},
        {"field_key": "pregnancy_status", "field_type": "select", "label": "Pregnancy Status", "required": False, "display_order": 3, "data_source": "pregnancy_status"},
        {"field_key": "pregnancy_remarks", "field_type": "textarea", "label": "Pregnancy Remarks", "required": False, "display_order": 4},
    ],

    # ── Vitals (latest snapshot) ──────────────────────────────────
    "vitals": [
        {"field_key": "height_cm", "field_type": "number", "label": "Height (cm)", "placeholder": "e.g. 170", "required": False, "display_order": 1},
        {"field_key": "weight_kg", "field_type": "number", "label": "Weight (kg)", "placeholder": "e.g. 70", "required": False, "display_order": 2},
        {"field_key": "bmi", "field_type": "number", "label": "BMI", "required": False, "display_order": 3, "helper_text": "Auto-calculated from height & weight"},
        {"field_key": "blood_pressure_systolic", "field_type": "number", "label": "BP Systolic (mmHg)", "placeholder": "e.g. 120", "required": False, "display_order": 4},
        {"field_key": "blood_pressure_diastolic", "field_type": "number", "label": "BP Diastolic (mmHg)", "placeholder": "e.g. 80", "required": False, "display_order": 5},
        {"field_key": "heart_rate", "field_type": "number", "label": "Heart Rate (bpm)", "placeholder": "e.g. 72", "required": False, "display_order": 6},
        {"field_key": "spo2", "field_type": "number", "label": "SpO2 (%)", "placeholder": "e.g. 98", "required": False, "display_order": 7},
        {"field_key": "temperature", "field_type": "number", "label": "Temperature (\u00b0F)", "placeholder": "e.g. 98.6", "required": False, "display_order": 8},
        {"field_key": "blood_sugar_fasting", "field_type": "number", "label": "Blood Sugar - Fasting (mg/dL)", "required": False, "display_order": 9},
        {"field_key": "blood_sugar_pp", "field_type": "number", "label": "Blood Sugar - PP (mg/dL)", "required": False, "display_order": 10},
    ],

    # ── Habits ─────────────────────────────────────────────────────
    "habits": [
        {"field_key": "smoking", "field_type": "select", "label": "Smoking", "required": False, "display_order": 1, "options": ["Never", "Occasionally", "Regularly", "Former"]},
        {"field_key": "alcohol", "field_type": "select", "label": "Alcohol", "required": False, "display_order": 2, "options": ["Never", "Occasionally", "Regularly", "Former"]},
        {"field_key": "tobacco", "field_type": "select", "label": "Tobacco (Chewing)", "required": False, "display_order": 3, "options": ["Never", "Occasionally", "Regularly", "Former"]},
        {"field_key": "drugs", "field_type": "select", "label": "Recreational Drugs", "required": False, "display_order": 4, "options": ["Never", "Occasionally", "Regularly", "Former"]},
        {"field_key": "exercise", "field_type": "select", "label": "Exercise", "required": False, "display_order": 5, "options": ["None", "Light", "Moderate", "Heavy"]},
        {"field_key": "diet", "field_type": "select", "label": "Diet", "required": False, "display_order": 6, "options": ["Vegetarian", "Non-Vegetarian", "Vegan", "Eggetarian"]},
        {"field_key": "sleep_pattern", "field_type": "select", "label": "Sleep Pattern", "required": False, "display_order": 7, "options": ["<5 hrs", "5-6 hrs", "6-8 hrs", "8+ hrs"]},
        {"field_key": "caffeine", "field_type": "select", "label": "Caffeine Intake", "required": False, "display_order": 8, "options": ["None", "1-2 cups/day", "3-4 cups/day", "5+ cups/day"]},
    ],

    # ── Surgeries ──────────────────────────────────────────────────
    "surgeries": [
        {"field_key": "surgery_list", "field_type": "repeater", "label": "Surgeries", "required": False, "display_order": 1, "helper_text": "Add past surgeries with date and details",
         "options": {
             "fields": [
                 {"key": "surgery_type", "label": "Surgery Type", "type": "select", "data_source": "surgery_types"},
                 {"key": "surgery_date", "label": "Date", "type": "date"},
                 {"key": "hospital", "label": "Hospital / Clinic", "type": "text"},
                 {"key": "surgeon_name", "label": "Surgeon Name", "type": "text"},
                 {"key": "notes", "label": "Notes", "type": "textarea"},
             ]
         }},
    ],

    # ── Health Records ─────────────────────────────────────────────
    "health_records": [
        {"field_key": "health_record_list", "field_type": "record_list", "label": "Health Records", "required": False, "display_order": 1, "helper_text": "Upload lab reports, imaging, discharge summaries, etc.",
         "options": {
             "fields": [
                 {"key": "record_type", "label": "Record Type", "type": "select", "data_source": "record_types"},
                 {"key": "record_date", "label": "Date", "type": "date"},
                 {"key": "title", "label": "Title / Description", "type": "text"},
                 {"key": "attachment", "label": "Attachment", "type": "file"},
                 {"key": "notes", "label": "Notes", "type": "textarea"},
             ]
         }},
    ],

    # ── Previous Prescriptions ─────────────────────────────────────
    "previous_prescriptions": [
        {"field_key": "prescription_list", "field_type": "record_list", "label": "Previous Prescriptions", "required": False, "display_order": 1, "helper_text": "Your prescriptions from consultations appear here automatically. You can also upload external prescriptions."},
    ],

    # ── House / Family Group ───────────────────────────────────────
    "house_family_group": [
        {"field_key": "group_members", "field_type": "group_manager", "label": "Family Members", "required": False, "display_order": 1, "helper_text": "Manage your family group. Add members, send invites, and control permissions."},
    ],
}
