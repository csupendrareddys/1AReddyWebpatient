"""
Default section + field configuration for the Doctor SIGNUP page.

Mirrors ``doctor_profile_config/default_fields.py`` but covers the much
smaller field set that the signup form actually collects. Sections:

  * account           — phone, password, email
  * personal          — first/last name, dob, gender
  * identity          — registration & ID documents
  * address           — communication address
  * qualifications_ug — UG degree / college / specialization (admin lists)
  * qualifications_pg — PG degree / college / specialization (admin lists)
  * qualifications_ss — Super-speciality lists

``LOCKED_FIELD_KEYS`` enumerates fields the admin MUST NOT be able to hide
or rename. The service layer's required-field guard reads this set.
Admins can still edit ``label`` / ``placeholder`` / ``helper_text`` /
``translations`` on locked fields — only ``is_present`` / ``field_key`` /
``field_type`` / ``data_source`` are frozen.
"""

# Field keys the admin is not allowed to hide or change the type of.
# Hiding or remapping any of these would break the signup flow itself
# (no way to authenticate the new account afterwards, etc).
LOCKED_FIELD_KEYS = frozenset({
    'phone_number',
    'password',
    'confirm_password',
    'first_name',
    'last_name',
    # The registration number is what every Indian medical body uses to
    # uniquely identify a doctor — it's how we de-duplicate accounts and
    # how the admin verifies the doctor's credentials. Locking it avoids
    # a tenant accidentally letting a doctor sign up with no MCI/NMC id.
    'registration_number',
})


# ---------------------------------------------------------------------------
# Sections — stored in PageConfig.fields JSON
# ---------------------------------------------------------------------------
DOCTOR_SIGNUP_SECTIONS = {
    "sections": [
        {
            "key": "account",
            "label": "Account",
            "display_order": 1,
            "is_present": True,
            "translations": {
                "te": "ఖాతా",
                "hi": "खाता",
            },
        },
        {
            "key": "personal",
            "label": "Personal Details",
            "display_order": 2,
            "is_present": True,
            "translations": {
                "te": "వ్యక్తిగత వివరాలు",
                "hi": "व्यक्तिगत विवरण",
            },
        },
        {
            "key": "identity",
            "label": "Identity & Registration",
            "display_order": 3,
            "is_present": True,
            "translations": {
                "te": "గుర్తింపు & నమోదు",
                "hi": "पहचान और पंजीकरण",
            },
        },
        {
            "key": "address",
            "label": "Address",
            "display_order": 4,
            "is_present": True,
            "translations": {
                "te": "చిరునామా",
                "hi": "पता",
            },
        },
        {
            "key": "qualifications_ug",
            "label": "Qualifications — Graduation (UG)",
            "display_order": 5,
            "is_present": True,
            "translations": {
                "te": "అర్హతలు — గ్రాడ్యుయేషన్",
                "hi": "योग्यता — स्नातक",
            },
        },
        {
            "key": "qualifications_pg",
            "label": "Qualifications — Post Graduation (PG)",
            "display_order": 6,
            "is_present": True,
            "translations": {
                "te": "అర్హతలు — పోస్ట్ గ్రాడ్యుయేషన్",
                "hi": "योग्यता — स्नातकोत्तर",
            },
        },
        {
            "key": "qualifications_ss",
            "label": "Qualifications — Super Speciality",
            "display_order": 7,
            "is_present": True,
            "translations": {
                "te": "అర్హతలు — సూపర్ స్పెషాలిటీ",
                "hi": "योग्यता — सुपर स्पेशियलिटी",
            },
        },
    ],
}


def _qualification_fields(level):
    """
    Build the three dropdown field defs for one qualification level
    (UG / PG / SS). All three pull options from admin-managed master lists,
    filtered by qualification level on the data_resolver side.
    """
    label_prefix = {
        'ug': 'Graduation (UG)',
        'pg': 'Post Graduation (PG)',
        'super_speciality': 'Super Speciality',
    }[level]
    return [
        {
            "field_key": f"{level}_degree",
            "field_type": "select",
            "label": f"{label_prefix} Degree",
            "placeholder": f"Select your {label_prefix} degree",
            "data_source": f"master_degrees:{level}",
            "required": True,
            "display_order": 1,
            "is_present": True,
        },
        {
            "field_key": f"{level}_specialization",
            "field_type": "select",
            "label": f"{label_prefix} Specialization",
            "placeholder": f"Select your {label_prefix} specialization",
            "data_source": f"master_specializations:{level}",
            "required": True,
            "display_order": 2,
            "is_present": True,
        },
        {
            "field_key": f"{level}_college",
            "field_type": "select",
            "label": f"{label_prefix} College / Institution",
            "placeholder": f"Select your {label_prefix} college",
            "data_source": f"master_colleges:{level}",
            "required": True,
            "display_order": 3,
            "is_present": True,
        },
        {
            "field_key": f"{level}_year_of_passing",
            "field_type": "number",
            "label": f"{label_prefix} Year of Passing",
            "placeholder": "YYYY",
            "required": True,
            "display_order": 4,
            "is_present": True,
        },
        {
            "field_key": f"{level}_certificate",
            "field_type": "file",
            "label": f"{label_prefix} Certificate",
            "helper_text": "Upload a scan/photo of your degree certificate.",
            "required": False,
            "display_order": 5,
            "is_present": True,
        },
    ]


# ---------------------------------------------------------------------------
# Fields — one PageFieldConfig row per entry, grouped by section_key
# ---------------------------------------------------------------------------
DOCTOR_SIGNUP_FIELDS = {
    "account": [
        {
            "field_key": "phone_number",
            "field_type": "tel",
            "label": "Mobile Number",
            "placeholder": "10-digit Indian mobile number",
            "helper_text": "We'll send an OTP to verify this number.",
            "required": True,
            "display_order": 1,
            "is_present": True,
            "validation_regex": r"^[6-9]\d{9}$",
            "validation_message": "Enter a valid 10-digit Indian mobile number.",
        },
        {
            "field_key": "password",
            "field_type": "password",
            "label": "Password",
            "placeholder": "At least 8 characters",
            "helper_text": "Must include upper + lower case, a digit, and a special character.",
            "required": True,
            "min_length": 8,
            "max_length": 128,
            "display_order": 2,
            "is_present": True,
        },
        {
            "field_key": "confirm_password",
            "field_type": "password",
            "label": "Confirm Password",
            "placeholder": "Re-enter your password",
            "required": True,
            "display_order": 3,
            "is_present": True,
        },
        {
            "field_key": "email",
            "field_type": "email",
            "label": "Email",
            "placeholder": "doctor@example.com",
            "required": False,
            "display_order": 4,
            "is_present": True,
        },
    ],
    "personal": [
        {
            "field_key": "first_name",
            "field_type": "text",
            "label": "First Name",
            "placeholder": "Enter first name",
            "required": True,
            "max_length": 100,
            "display_order": 1,
            "is_present": True,
        },
        {
            "field_key": "middle_name",
            "field_type": "text",
            "label": "Middle Name",
            "placeholder": "Enter middle name (optional)",
            "required": False,
            "max_length": 100,
            "display_order": 2,
            "is_present": True,
        },
        {
            "field_key": "last_name",
            "field_type": "text",
            "label": "Last Name",
            "placeholder": "Enter last name",
            "required": True,
            "max_length": 100,
            "display_order": 3,
            "is_present": True,
        },
        {
            "field_key": "dob",
            "field_type": "date",
            "label": "Date of Birth",
            "placeholder": "YYYY-MM-DD",
            "required": False,
            "display_order": 4,
            "is_present": True,
        },
        {
            "field_key": "gender",
            "field_type": "select",
            "label": "Gender",
            "placeholder": "Select gender",
            "data_source": "gender_options",
            "required": False,
            "display_order": 5,
            "is_present": True,
        },
    ],
    "identity": [
        {
            "field_key": "registration_number",
            "field_type": "text",
            "label": "Medical Registration Number",
            "placeholder": "e.g. MCI/NMC reg no.",
            "helper_text": "Issued by your state medical council.",
            "required": True,
            "display_order": 1,
            "is_present": True,
        },
        {
            "field_key": "registration_council",
            "field_type": "select",
            "label": "Registration Council",
            "placeholder": "Select council",
            "data_source": "master_registration_councils",
            "required": True,
            "display_order": 2,
            "is_present": True,
        },
        {
            "field_key": "registration_year",
            "field_type": "number",
            "label": "Registration Year",
            "placeholder": "YYYY",
            "required": True,
            "display_order": 3,
            "is_present": True,
        },
        {
            "field_key": "registration_certificate",
            "field_type": "file",
            "label": "Registration Certificate",
            "helper_text": "Upload a scan/photo of your medical registration certificate.",
            "required": True,
            "display_order": 4,
            "is_present": True,
        },
        {
            "field_key": "aadhaar_number",
            "field_type": "text",
            "label": "Aadhaar Number",
            "placeholder": "12-digit Aadhaar",
            "required": False,
            "min_length": 12,
            "max_length": 12,
            "display_order": 5,
            "is_present": True,
            "validation_regex": r"^\d{12}$",
            "validation_message": "Aadhaar must be exactly 12 digits.",
        },
        {
            "field_key": "aadhaar_attachment",
            "field_type": "file",
            "label": "Aadhaar Attachment",
            "helper_text": "Upload a scan/photo of your Aadhaar card (front + back).",
            "required": False,
            "display_order": 6,
            "is_present": True,
        },
    ],
    "address": [
        {
            "field_key": "address_line_1",
            "field_type": "text",
            "label": "Address Line 1",
            "placeholder": "Flat / Building / Street",
            "required": False,
            "max_length": 200,
            "display_order": 1,
            "is_present": True,
        },
        {
            "field_key": "address_line_2",
            "field_type": "text",
            "label": "Address Line 2",
            "placeholder": "Area / Landmark (optional)",
            "required": False,
            "max_length": 200,
            "display_order": 2,
            "is_present": True,
        },
        {
            "field_key": "city",
            "field_type": "text",
            "label": "City",
            "placeholder": "City",
            "required": False,
            "max_length": 100,
            "display_order": 3,
            "is_present": True,
        },
        {
            "field_key": "state",
            "field_type": "select",
            "label": "State",
            "placeholder": "Select state",
            "data_source": "master_states",
            "required": False,
            "display_order": 4,
            "is_present": True,
        },
        {
            "field_key": "pincode",
            "field_type": "text",
            "label": "Pincode",
            "placeholder": "6-digit pincode",
            "required": False,
            "min_length": 6,
            "max_length": 6,
            "display_order": 5,
            "is_present": True,
            "validation_regex": r"^\d{6}$",
            "validation_message": "Pincode must be exactly 6 digits.",
        },
    ],
    "qualifications_ug": _qualification_fields('ug'),
    "qualifications_pg": _qualification_fields('pg'),
    "qualifications_ss": _qualification_fields('super_speciality'),
}
