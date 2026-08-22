"""
Default section and field configurations for Doctor Profile page.

Covers ALL sections and fields from the Doctor Profile form:
  - Personal & Professional Details
  - Additional Personal Details
  - Identity Documents
  - Female Health Details
  - Communication (Current) Address
  - Permanent Address
  - Signatures
  - About Me
  - Education — Graduation
  - Education — Post Graduation
  - Education — Super Speciality
  - Education — Other Certification
  - Working Days & Hours
  - Consultation Pricing
"""

# ---------------------------------------------------------------------------
# Sections — stored in PageConfig.fields JSON
# ---------------------------------------------------------------------------
DOCTOR_PROFILE_SECTIONS = {
    "sections": [
        # ── Tab 0: Personal & Professional ─────────────────────────────
        {
            "key": "personal_details",
            "label": "Personal & Professional Details",
            "display_order": 1,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "వ్యక్తిగత & వృత్తిపరమైన వివరాలు",
                "hi": "व्यक्तिगत और पेशेवर विवरण",
            },
        },
        {
            "key": "additional_personal_details",
            "label": "Additional Personal Details",
            "display_order": 2,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "అదనపు వ్యక్తిగత వివరాలు",
                "hi": "अतिरिक्त व्यक्तिगत विवरण",
            },
        },
        {
            "key": "identity_documents",
            "label": "Identity Documents",
            "display_order": 3,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "గుర్తింపు పత్రాలు",
                "hi": "पहचान दस्तावेज़",
            },
        },
        {
            "key": "female_health_details",
            "label": "Female Health Details",
            "display_order": 4,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "మహిళా ఆరోగ్య వివరాలు",
                "hi": "महिला स्वास्थ्य विवरण",
            },
        },
        {
            "key": "current_address",
            "label": "Communication (Current) Address",
            "display_order": 5,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "ప్రస్తుత చిరునామా",
                "hi": "वर्तमान पता",
            },
        },
        {
            "key": "permanent_address",
            "label": "Permanent Address",
            "display_order": 6,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "శాశ్వత చిరునామా",
                "hi": "स्थायी पता",
            },
        },
        # ── Tab 1: Signatures ──────────────────────────────────────────
        {
            "key": "signatures",
            "label": "Signatures",
            "display_order": 7,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "సంతకాలు",
                "hi": "हस्ताक्षर",
            },
        },
        # ── Tab 2: About Me ────────────────────────────────────────────
        {
            "key": "about_me",
            "label": "About Me",
            "display_order": 8,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "నా గురించి",
                "hi": "मेरे बारे में",
            },
        },
        # ── Tab 3: Education ───────────────────────────────────────────
        {
            "key": "education_graduation",
            "label": "Education — Graduation",
            "display_order": 9,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "విద్య — గ్రాడ్యుయేషన్",
                "hi": "शिक्षा — स्नातक",
            },
        },
        {
            "key": "education_post_graduation",
            "label": "Education — Post Graduation",
            "display_order": 10,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "విద్య — పోస్ట్ గ్రాడ్యుయేషన్",
                "hi": "शिक्षा — स्नातकोत्तर",
            },
        },
        {
            "key": "education_super_speciality",
            "label": "Education — Super Speciality",
            "display_order": 11,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "విద్య — సూపర్ స్పెషాలిటీ",
                "hi": "शिक्षा — सुपर स्पेशियलिटी",
            },
        },
        {
            "key": "education_other_certification",
            "label": "Education — Other Certification",
            "display_order": 12,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "విద్య — ఇతర సర్టిఫికేషన్",
                "hi": "शिक्षा — अन्य प्रमाणपत्र",
            },
        },
        # ── Tab 4 (sub-tab): Bank Details ─────────────────────────────
        {
            "key": "bank_details",
            "label": "Bank Details",
            "display_order": 13,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "బ్యాంక్ వివరాలు",
                "hi": "बैंक विवरण",
            },
        },
        # ── Tab 5 (sub-tab): Declaration & Documents ─────────────────
        {
            "key": "declaration_documents",
            "label": "Declaration & Documents",
            "display_order": 14,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "ప్రకటన & పత్రాలు",
                "hi": "घोषणा और दस्तावेज़",
            },
        },
        # ── Tab 6: Availability ────────────────────────────────────────
        {
            "key": "working_days_hours",
            "label": "Working Days & Hours",
            "display_order": 15,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "పని దినాలు & గంటలు",
                "hi": "कार्य दिवस और घंटे",
            },
        },
        # ── Tab 7: Pricing ─────────────────────────────────────────────
        {
            "key": "consultation_pricing",
            "label": "Consultation Pricing",
            "display_order": 16,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "సంప్రదింపు ధరలు",
                "hi": "परामर्श मूल्य निर्धारण",
            },
        },
        # ── Tab 8: Analytics ──────────────────────────────────────────────
        {
            "key": "doctor_analytics",
            "label": "Analytics",
            "display_order": 17,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "విశ్లేషణలు",
                "hi": "विश्लेषिकी",
            },
        },
        # ── Tab 9: Attendance & Activity ──────────────────────────────────
        {
            "key": "doctor_attendance",
            "label": "Attendance & Activity",
            "display_order": 18,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "హాజరు & కార్యకలాపాలు",
                "hi": "उपस्थिति और गतिविधि",
            },
        },
        # ── Treatable Symptoms ────────────────────────────────────────
        {
            "key": "treatable_symptoms",
            "label": "Treatable Symptoms",
            "display_order": 19,
            "is_present": True,
            "user_types": ["doctor", "admin"],
            "translations": {
                "te": "చికిత్స చేయగల లక్షణాలు",
                "hi": "उपचार योग्य लक्षण",
            },
        },
    ]
}


# ---------------------------------------------------------------------------
# Helper: reusable address fields template
# ---------------------------------------------------------------------------
def _address_fields(prefix, start_order=1):
    """Return address field definitions for a given prefix (current_ / permanent_)."""
    return [
        {"field_key": f"{prefix}address", "field_type": "textarea", "label": "Address", "placeholder": "Enter full address", "required": True, "display_order": start_order},
        {"field_key": f"{prefix}landmark", "field_type": "text", "label": "Landmark", "placeholder": "Nearby landmark", "required": False, "display_order": start_order + 1},
        {"field_key": f"{prefix}city", "field_type": "text", "label": "City", "placeholder": "Enter city", "required": True, "display_order": start_order + 2},
        {"field_key": f"{prefix}district", "field_type": "text", "label": "District", "placeholder": "Enter district", "required": False, "display_order": start_order + 3},
        {"field_key": f"{prefix}state", "field_type": "select", "label": "State", "required": True, "display_order": start_order + 4, "data_source": "master_states"},
        {"field_key": f"{prefix}pincode", "field_type": "text", "label": "Pincode", "placeholder": "Enter 6-digit pincode", "required": True, "display_order": start_order + 5, "validation_regex": "^[0-9]{6}$", "validation_message": "Pincode must be 6 digits"},
        {"field_key": f"{prefix}country", "field_type": "text", "label": "Country", "placeholder": "Enter country", "required": False, "display_order": start_order + 6},
        {"field_key": f"{prefix}gps_location", "field_type": "text", "label": "GPS Location", "placeholder": "Latitude, Longitude", "required": False, "display_order": start_order + 7},
        {"field_key": f"{prefix}address_proof_type", "field_type": "select", "label": "Address Proof Type", "required": False, "display_order": start_order + 8},
        {"field_key": f"{prefix}address_proof_number", "field_type": "text", "label": "Address Proof Number", "placeholder": "Enter proof number", "required": False, "display_order": start_order + 9},
        {"field_key": f"{prefix}address_proof_document", "field_type": "file", "label": "Address Proof Document", "helper_text": "Upload address proof (PDF/Image)", "required": False, "display_order": start_order + 10},
    ]


def _education_fields(prefix, label_prefix, start_order=1, level=None):
    """Return education field definitions for a given education level.

    ``level`` (one of ``'ug'`` / ``'pg'`` / ``'super_speciality'``) — when
    set, the data_source on the level-aware fields (degree /
    specialization / university / institute) is suffixed with
    ``:<level>`` so the data_resolver filters master_data rows by
    qualification_level. Without this, a field named ``ug_degree``
    silently shows ALL degrees regardless of level — the editor
    Options block contradicts the live signup behavior. The signup
    page-config's matching ``_education_fields`` already uses this
    pattern (see ``app/api/doctor_signup_config/default_fields.py``);
    parity here keeps the profile editor honest.

    ``level=None`` is back-compat for any caller that doesn't yet
    distinguish levels (no behaviour change).
    """
    lvl = f":{level}" if level else ""
    return [
        {"field_key": f"{prefix}degree", "field_type": "select", "label": f"{label_prefix} Degree", "required": True, "display_order": start_order, "data_source": f"master_degrees{lvl}"},
        {"field_key": f"{prefix}specialization", "field_type": "select", "label": f"{label_prefix} Specialization", "required": True, "display_order": start_order + 1, "data_source": f"master_specializations{lvl}" if level else "category:specialization"},
        {"field_key": f"{prefix}state", "field_type": "select", "label": "State", "required": True, "display_order": start_order + 2, "data_source": "master_states"},
        {"field_key": f"{prefix}university", "field_type": "select", "label": "University / Bodies", "required": True, "display_order": start_order + 3, "data_source": f"master_universities{lvl}"},
        {"field_key": f"{prefix}institute", "field_type": "select", "label": "Institute / College", "required": True, "display_order": start_order + 4, "data_source": f"master_colleges{lvl}"},
        {"field_key": f"{prefix}year", "field_type": "number", "label": "Year of Graduation", "placeholder": "e.g., 2015", "required": True, "display_order": start_order + 5},
        {"field_key": f"{prefix}evaluation_criteria", "field_type": "select", "label": "Evaluation Criteria", "required": False, "display_order": start_order + 6, "data_source": "master_evaluation_criteria"},
        {"field_key": f"{prefix}obtained_score", "field_type": "text", "label": "Obtained Percentage / CGPA / Class", "placeholder": "e.g., 85% or 8.5 CGPA", "required": False, "display_order": start_order + 7},
        {"field_key": f"{prefix}registration_number", "field_type": "text", "label": "Registration Number", "placeholder": "Enter registration number", "required": False, "display_order": start_order + 8},
        {"field_key": f"{prefix}certificate_upload", "field_type": "file", "label": f"{label_prefix} Certificate", "helper_text": "Upload degree certificate (PDF/Image)", "required": True, "display_order": start_order + 9},
        {"field_key": f"{prefix}marksheet_upload", "field_type": "file", "label": f"{label_prefix} Marksheet / Transcript", "helper_text": "Upload marksheet or transcript (PDF/Image)", "required": True, "display_order": start_order + 10},
    ]


# ---------------------------------------------------------------------------
# Field definitions — stored as DoctorProfileFieldConfig rows
# ---------------------------------------------------------------------------
DOCTOR_PROFILE_FIELDS = {
    # ══════════════════════════════════════════════════════════════════
    # 1. Personal & Professional Details
    # ══════════════════════════════════════════════════════════════════
    "personal_details": [
        {"field_key": "profile_image", "field_type": "file", "label": "Profile Image", "helper_text": "Upload a recent passport-size photo", "required": False, "display_order": 1},
        {"field_key": "first_name", "field_type": "text", "label": "First Name", "placeholder": "Enter first name", "required": True, "display_order": 2, "max_length": 100},
        {"field_key": "middle_name", "field_type": "text", "label": "Middle Name", "placeholder": "Enter middle name", "required": False, "display_order": 3, "max_length": 100},
        {"field_key": "last_name", "field_type": "text", "label": "Last Name", "placeholder": "Enter last name", "required": False, "display_order": 4, "max_length": 100},
        {"field_key": "phone", "field_type": "tel", "label": "Phone Number", "required": True, "display_order": 5, "validation_regex": r"^[6-9]\d{9}$", "validation_message": "Enter a valid 10-digit Indian mobile number"},
        {"field_key": "email", "field_type": "email", "label": "Email", "required": True, "display_order": 6},
        {"field_key": "gender", "field_type": "select", "label": "Gender", "required": False, "display_order": 7, "data_source": "gender_options",
         "options": [{"value": "male", "label": "Male"}, {"value": "female", "label": "Female"}, {"value": "other", "label": "Other"}]},
        {"field_key": "dob", "field_type": "date", "label": "Date of Birth", "required": False, "display_order": 8},
        {"field_key": "registration_number", "field_type": "text", "label": "Registration Number", "placeholder": "Medical registration number", "required": True, "display_order": 9},
        {"field_key": "experience_years", "field_type": "number", "label": "Years of Experience", "placeholder": "e.g., 10", "required": False, "display_order": 10},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 2. Additional Personal Details
    # ══════════════════════════════════════════════════════════════════
    "additional_personal_details": [
        {"field_key": "alternate_phone", "field_type": "tel", "label": "Alternate Phone Number", "placeholder": "Enter alternate phone number", "required": False, "display_order": 1},
        {"field_key": "alternate_email", "field_type": "email", "label": "Alternate Email", "placeholder": "Enter alternate email", "required": False, "display_order": 2},
        {"field_key": "height_cm", "field_type": "number", "label": "Height (cm)", "placeholder": "e.g., 170", "required": False, "display_order": 3},
        {"field_key": "weight_kg", "field_type": "number", "label": "Weight (kg)", "placeholder": "e.g., 70", "required": False, "display_order": 4},
        {"field_key": "category", "field_type": "select", "label": "Category", "required": False, "display_order": 5, "data_source": "master_categories"},
        {"field_key": "religion", "field_type": "select", "label": "Religion", "required": False, "display_order": 6, "data_source": "master_religions"},
        {"field_key": "citizenship", "field_type": "text", "label": "Citizenship", "placeholder": "e.g., Indian", "required": False, "display_order": 7},
        {"field_key": "languages_known", "field_type": "multi_select", "label": "Languages Known", "placeholder": "Select languages", "required": False, "display_order": 8, "data_source": "master_languages"},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 3. Identity Documents
    # ══════════════════════════════════════════════════════════════════
    "identity_documents": [
        {"field_key": "aadhar_number", "field_type": "text", "label": "Aadhaar Number", "placeholder": "Enter 12-digit Aadhaar number", "required": True, "display_order": 1, "validation_regex": r"^\d{12}$", "validation_message": "Aadhaar number must be 12 digits"},
        {"field_key": "aadhar_attachment", "field_type": "file", "label": "Aadhaar Proof", "helper_text": "Upload Aadhaar card (PDF/Image)", "required": True, "display_order": 2},
        {"field_key": "pan_number", "field_type": "text", "label": "PAN Number", "placeholder": "Enter PAN number", "required": False, "display_order": 3, "validation_regex": r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$", "validation_message": "Invalid PAN format (e.g., ABCDE1234F)"},
        {"field_key": "pan_attachment", "field_type": "file", "label": "PAN Proof", "helper_text": "Upload PAN card (PDF/Image)", "required": False, "display_order": 4},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 4. Female Health Details (conditional — shown when gender=female)
    # ══════════════════════════════════════════════════════════════════
    "female_health_details": [
        {"field_key": "lmp_date", "field_type": "date", "label": "LMP Date", "helper_text": "Last Menstrual Period date", "required": False, "display_order": 1},
        {"field_key": "lmp_remarks", "field_type": "textarea", "label": "LMP Remarks", "placeholder": "Enter any remarks", "required": False, "display_order": 2},
        {"field_key": "pregnancy_status", "field_type": "select", "label": "Pregnancy Status", "required": False, "display_order": 3},
        {"field_key": "pregnancy_status_remarks", "field_type": "textarea", "label": "Pregnancy Status Remarks", "placeholder": "Enter any remarks", "required": False, "display_order": 4},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 5. Communication (Current) Address
    # ══════════════════════════════════════════════════════════════════
    "current_address": _address_fields("current_"),

    # ══════════════════════════════════════════════════════════════════
    # 6. Permanent Address
    # ══════════════════════════════════════════════════════════════════
    "permanent_address": _address_fields("permanent_"),

    # ══════════════════════════════════════════════════════════════════
    # 7. Signatures
    # ══════════════════════════════════════════════════════════════════
    "signatures": [
        {"field_key": "signature_1", "field_type": "file", "label": "Signature 1", "helper_text": "Upload a clear image of your signature (required)", "required": True, "display_order": 1},
        {"field_key": "signature_1_verified", "field_type": "text", "label": "Signature 1 Verification Status", "required": False, "display_order": 2, "is_present": False},
        {"field_key": "signature_2", "field_type": "file", "label": "Signature 2", "helper_text": "Upload a second signature (optional)", "required": False, "display_order": 3},
        {"field_key": "signature_2_verified", "field_type": "text", "label": "Signature 2 Verification Status", "required": False, "display_order": 4, "is_present": False},
        {"field_key": "digital_signature", "field_type": "file", "label": "Digital Signature", "helper_text": "Upload digital signature file (required)", "required": True, "display_order": 5},
        {"field_key": "digital_signature_verified", "field_type": "text", "label": "Digital Signature Verification Status", "required": False, "display_order": 6, "is_present": False},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 8. About Me
    # ══════════════════════════════════════════════════════════════════
    "about_me": [
        {"field_key": "brief_about_text", "field_type": "textarea", "label": "Brief About", "placeholder": "Write a brief description about yourself…", "required": False, "display_order": 1},
        {"field_key": "brief_about_attachment", "field_type": "file", "label": "Brief About — Attachment", "helper_text": "Optional supporting document", "required": False, "display_order": 2},
        {"field_key": "brief_about_verified", "field_type": "text", "label": "Brief About Verification", "required": False, "display_order": 3, "is_present": False},
        {"field_key": "nature_of_work_text", "field_type": "textarea", "label": "Nature of Work", "placeholder": "Describe the nature of your work…", "required": False, "display_order": 4},
        {"field_key": "nature_of_work_attachment", "field_type": "file", "label": "Nature of Work — Attachment", "helper_text": "Optional supporting document", "required": False, "display_order": 5},
        {"field_key": "nature_of_work_verified", "field_type": "text", "label": "Nature of Work Verification", "required": False, "display_order": 6, "is_present": False},
        {"field_key": "currently_working_with_text", "field_type": "textarea", "label": "Currently Working With", "placeholder": "Hospital / clinic / institution you work with…", "required": False, "display_order": 7},
        {"field_key": "currently_working_with_attachment", "field_type": "file", "label": "Currently Working With — Attachment", "helper_text": "Optional supporting document", "required": False, "display_order": 8},
        {"field_key": "currently_working_with_verified", "field_type": "text", "label": "Currently Working With Verification", "required": False, "display_order": 9, "is_present": False},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 9. Education — Graduation
    # ══════════════════════════════════════════════════════════════════
    "education_graduation": _education_fields("ug_", "UG / Bachelor's", level="ug"),

    # ══════════════════════════════════════════════════════════════════
    # 10. Education — Post Graduation
    # ══════════════════════════════════════════════════════════════════
    "education_post_graduation": _education_fields("pg_", "PG / Diploma", level="pg"),

    # ══════════════════════════════════════════════════════════════════
    # 11. Education — Super Speciality
    # ══════════════════════════════════════════════════════════════════
    "education_super_speciality": _education_fields("ss_", "Super Speciality", level="super_speciality"),

    # ══════════════════════════════════════════════════════════════════
    # 12. Education — Other Certification
    # ══════════════════════════════════════════════════════════════════
    "education_other_certification": [
        {"field_key": "oc_course_name", "field_type": "text", "label": "Course Name", "placeholder": "Enter course name", "required": False, "display_order": 1},
        {"field_key": "oc_specialization", "field_type": "select", "label": "Specialization", "required": False, "display_order": 2, "data_source": "category:specialization"},
        {"field_key": "oc_state", "field_type": "select", "label": "State", "required": False, "display_order": 3, "data_source": "master_states"},
        {"field_key": "oc_university", "field_type": "select", "label": "University / Bodies", "required": False, "display_order": 4, "data_source": "master_universities"},
        {"field_key": "oc_institute", "field_type": "select", "label": "Institute / College", "required": False, "display_order": 5, "data_source": "master_colleges"},
        {"field_key": "oc_year", "field_type": "number", "label": "Year of Course", "placeholder": "e.g., 2020", "required": False, "display_order": 6},
        {"field_key": "oc_evaluation_criteria", "field_type": "select", "label": "Evaluation Criteria", "required": False, "display_order": 7, "data_source": "master_evaluation_criteria"},
        {"field_key": "oc_obtained_score", "field_type": "text", "label": "Obtained Percentage / CGPA / Class", "placeholder": "e.g., 85%", "required": False, "display_order": 8},
        {"field_key": "oc_registration_number", "field_type": "text", "label": "Registration Number", "placeholder": "Enter registration number", "required": False, "display_order": 9},
        {"field_key": "oc_certificate_upload", "field_type": "file", "label": "Certificate", "helper_text": "Upload certificate (PDF/Image)", "required": False, "display_order": 10},
        {"field_key": "oc_marksheet_upload", "field_type": "file", "label": "Marksheet / Transcript", "helper_text": "Upload marksheet (PDF/Image)", "required": False, "display_order": 11},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 13. Bank Details
    # ══════════════════════════════════════════════════════════════════
    "bank_details": [
        {"field_key": "bank_name", "field_type": "text", "label": "Bank Name", "placeholder": "Enter bank name", "required": True, "display_order": 1},
        {"field_key": "account_name", "field_type": "text", "label": "Account Holder Name", "placeholder": "Enter account holder name", "required": True, "display_order": 2},
        {"field_key": "account_number", "field_type": "text", "label": "Account Number", "placeholder": "Enter account number", "required": True, "display_order": 3, "validation_regex": r"^\d{9,18}$", "validation_message": "Account number must be 9-18 digits"},
        {"field_key": "ifsc_code", "field_type": "text", "label": "IFSC Code", "placeholder": "Enter IFSC code", "required": True, "display_order": 4, "validation_regex": r"^[A-Z]{4}0[A-Z0-9]{6}$", "validation_message": "Invalid IFSC format (e.g., SBIN0001234)"},
        {"field_key": "branch", "field_type": "text", "label": "Branch", "placeholder": "Enter branch name", "required": False, "display_order": 5},
        {"field_key": "passbook_upload", "field_type": "file", "label": "Bank Passbook", "helper_text": "Upload bank passbook (PDF/Image)", "required": False, "display_order": 6},
        {"field_key": "check_leaf_upload", "field_type": "file", "label": "Check Leaf", "helper_text": "Upload check leaf (PDF/Image)", "required": False, "display_order": 7},
        {"field_key": "bank_statement_upload", "field_type": "file", "label": "Bank Statement", "helper_text": "Upload bank statement (PDF/Image)", "required": False, "display_order": 8},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 14. Declaration & Documents
    # ══════════════════════════════════════════════════════════════════
    "declaration_documents": [
        {"field_key": "declaration_questions", "field_type": "dynamic", "label": "Declaration Questions", "helper_text": "Yes/No questions configured by admin", "required": False, "display_order": 1},
        {"field_key": "self_declaration_terms", "field_type": "checkbox", "label": "Terms & Conditions", "helper_text": "Doctor must accept terms and conditions", "required": True, "display_order": 2},
        {"field_key": "self_declaration_policies", "field_type": "checkbox", "label": "Company Policies", "helper_text": "Doctor must accept company policies", "required": True, "display_order": 3},
        {"field_key": "upload_documents", "field_type": "dynamic", "label": "Upload Documents", "helper_text": "Document types configured by admin", "required": False, "display_order": 4},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 15. Working Days & Hours
    # ══════════════════════════════════════════════════════════════════
    "working_days_hours": [
        # Slot configuration
        {"field_key": "slot_size_minutes", "field_type": "number", "label": "Slot Size (minutes)", "placeholder": "e.g., 15", "helper_text": "Must be a multiple of 5", "required": False, "display_order": 1},
        {"field_key": "slot_gap_minutes", "field_type": "number", "label": "Slot Gap (minutes)", "placeholder": "e.g., 5", "required": False, "display_order": 2},
        {"field_key": "start_ceiling", "field_type": "select", "label": "Start Ceiling", "helper_text": "0, 5, or 10 minutes", "required": False, "display_order": 3},
        # Day-wise start / end times
        {"field_key": "monday_start", "field_type": "time", "label": "Monday — Start Time", "required": False, "display_order": 4},
        {"field_key": "monday_end", "field_type": "time", "label": "Monday — End Time", "required": False, "display_order": 5},
        {"field_key": "tuesday_start", "field_type": "time", "label": "Tuesday — Start Time", "required": False, "display_order": 6},
        {"field_key": "tuesday_end", "field_type": "time", "label": "Tuesday — End Time", "required": False, "display_order": 7},
        {"field_key": "wednesday_start", "field_type": "time", "label": "Wednesday — Start Time", "required": False, "display_order": 8},
        {"field_key": "wednesday_end", "field_type": "time", "label": "Wednesday — End Time", "required": False, "display_order": 9},
        {"field_key": "thursday_start", "field_type": "time", "label": "Thursday — Start Time", "required": False, "display_order": 10},
        {"field_key": "thursday_end", "field_type": "time", "label": "Thursday — End Time", "required": False, "display_order": 11},
        {"field_key": "friday_start", "field_type": "time", "label": "Friday — Start Time", "required": False, "display_order": 12},
        {"field_key": "friday_end", "field_type": "time", "label": "Friday — End Time", "required": False, "display_order": 13},
        {"field_key": "saturday_start", "field_type": "time", "label": "Saturday — Start Time", "required": False, "display_order": 14},
        {"field_key": "saturday_end", "field_type": "time", "label": "Saturday — End Time", "required": False, "display_order": 15},
        {"field_key": "sunday_start", "field_type": "time", "label": "Sunday — Start Time", "required": False, "display_order": 16},
        {"field_key": "sunday_end", "field_type": "time", "label": "Sunday — End Time", "required": False, "display_order": 17},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 14. Consultation Pricing
    # ══════════════════════════════════════════════════════════════════
    "consultation_pricing": [
        {"field_key": "slot_0_10_price", "field_type": "number", "label": "0–10 min — Price (₹)", "placeholder": "Enter price", "required": False, "display_order": 1},
        {"field_key": "slot_0_10_description", "field_type": "text", "label": "0–10 min — Description", "placeholder": "Quick consultation", "required": False, "display_order": 2},
        {"field_key": "slot_10_20_price", "field_type": "number", "label": "10–20 min — Price (₹)", "placeholder": "Enter price", "required": False, "display_order": 3},
        {"field_key": "slot_10_20_description", "field_type": "text", "label": "10–20 min — Description", "placeholder": "Short consultation", "required": False, "display_order": 4},
        {"field_key": "slot_20_30_price", "field_type": "number", "label": "20–30 min — Price (₹)", "placeholder": "Enter price", "required": False, "display_order": 5},
        {"field_key": "slot_20_30_description", "field_type": "text", "label": "20–30 min — Description", "placeholder": "Standard consultation", "required": False, "display_order": 6},
        {"field_key": "slot_30_45_price", "field_type": "number", "label": "30–45 min — Price (₹)", "placeholder": "Enter price", "required": False, "display_order": 7},
        {"field_key": "slot_30_45_description", "field_type": "text", "label": "30–45 min — Description", "placeholder": "Extended consultation", "required": False, "display_order": 8},
        {"field_key": "slot_45_60_price", "field_type": "number", "label": "45–60 min — Price (₹)", "placeholder": "Enter price", "required": False, "display_order": 9},
        {"field_key": "slot_45_60_description", "field_type": "text", "label": "45–60 min — Description", "placeholder": "Detailed consultation", "required": False, "display_order": 10},
        {"field_key": "slot_60_plus_price", "field_type": "number", "label": "60+ min — Price (₹)", "placeholder": "Enter price", "required": False, "display_order": 11},
        {"field_key": "slot_60_plus_description", "field_type": "text", "label": "60+ min — Description", "placeholder": "Comprehensive consultation", "required": False, "display_order": 12},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 17. Analytics
    # ══════════════════════════════════════════════════════════════════
    "doctor_analytics": [
        {"field_key": "analytics_section_label", "field_type": "text", "label": "Analytics Tab Label", "placeholder": "Analytics", "required": False, "display_order": 1},
        {"field_key": "analytics_overview_visible", "field_type": "toggle", "label": "Show Analytics Overview", "required": False, "display_order": 2},
        {"field_key": "appointment_stats_label", "field_type": "text", "label": "Appointment Statistics Label", "placeholder": "Appointment Statistics", "required": False, "display_order": 3},
        {"field_key": "appointment_stats_visible", "field_type": "toggle", "label": "Show Appointment Statistics", "required": False, "display_order": 4},
        {"field_key": "revenue_stats_label", "field_type": "text", "label": "Revenue Statistics Label", "placeholder": "Revenue Statistics", "required": False, "display_order": 5},
        {"field_key": "revenue_stats_visible", "field_type": "toggle", "label": "Show Revenue Statistics", "required": False, "display_order": 6},
        {"field_key": "patient_stats_label", "field_type": "text", "label": "Patient Statistics Label", "placeholder": "Patient Statistics", "required": False, "display_order": 7},
        {"field_key": "patient_stats_visible", "field_type": "toggle", "label": "Show Patient Statistics", "required": False, "display_order": 8},
        {"field_key": "rating_stats_label", "field_type": "text", "label": "Rating & Reviews Label", "placeholder": "Rating & Reviews", "required": False, "display_order": 9},
        {"field_key": "rating_stats_visible", "field_type": "toggle", "label": "Show Rating & Reviews", "required": False, "display_order": 10},
        {"field_key": "consultation_breakdown_label", "field_type": "text", "label": "Consultation Breakdown Label", "placeholder": "Consultation Type Breakdown", "required": False, "display_order": 11},
        {"field_key": "consultation_breakdown_visible", "field_type": "toggle", "label": "Show Consultation Breakdown", "required": False, "display_order": 12},
    ],

    # ══════════════════════════════════════════════════════════════════
    # 18. Attendance & Activity
    # ══════════════════════════════════════════════════════════════════
    "doctor_attendance": [
        # ── Sub-stage visibility & labels ──
        {"field_key": "attendance_tab_label", "field_type": "text", "label": "Attendance Tab Label", "placeholder": "Attendance & Activity", "required": False, "display_order": 1},
        {"field_key": "allow_doctor_remarks", "field_type": "toggle", "label": "Allow Doctor to Submit Remarks", "helper_text": "Enable/disable the correction remarks feature for doctors", "required": False, "display_order": 2},

        # Acceptance Stage
        {"field_key": "acceptance_stage_visible", "field_type": "toggle", "label": "Show Acceptance Stage", "required": False, "display_order": 10},
        {"field_key": "acceptance_stage_label", "field_type": "text", "label": "Acceptance Stage Label", "placeholder": "Acceptance Stage", "required": False, "display_order": 11},
        {"field_key": "acceptance_auto_approved_label", "field_type": "text", "label": "Auto Approved — Label", "placeholder": "Auto Approved", "required": False, "display_order": 12},
        {"field_key": "acceptance_verified_label", "field_type": "text", "label": "Verified — Label", "placeholder": "Verified (Viewed)", "required": False, "display_order": 13},
        {"field_key": "acceptance_accepted_label", "field_type": "text", "label": "Accepted — Label", "placeholder": "Accepted", "required": False, "display_order": 14},
        {"field_key": "acceptance_rejected_label", "field_type": "text", "label": "Rejected — Label", "placeholder": "Rejected (Wrong Specialization)", "required": False, "display_order": 15},
        {"field_key": "acceptance_cancelled_label", "field_type": "text", "label": "Cancelled — Label", "placeholder": "Cancelled (Doctor Unavailable)", "required": False, "display_order": 16},
        {"field_key": "acceptance_rescheduled_label", "field_type": "text", "label": "Rescheduled — Label", "placeholder": "Rescheduled", "required": False, "display_order": 17},

        # Execution Stage
        {"field_key": "execution_stage_visible", "field_type": "toggle", "label": "Show Execution Stage", "required": False, "display_order": 20},
        {"field_key": "execution_stage_label", "field_type": "text", "label": "Execution Stage Label", "placeholder": "Execution Stage", "required": False, "display_order": 21},
        {"field_key": "execution_attended_label", "field_type": "text", "label": "Attended — Label", "placeholder": "Attended", "required": False, "display_order": 22},
        {"field_key": "execution_total_missed_label", "field_type": "text", "label": "Total Missed — Label", "placeholder": "Total Missed", "required": False, "display_order": 23},
        {"field_key": "execution_missed_doctor_label", "field_type": "text", "label": "Missed by Doctor — Label", "placeholder": "Missed by Doctor", "required": False, "display_order": 24},
        {"field_key": "execution_missed_patient_label", "field_type": "text", "label": "Missed by Patient — Label", "placeholder": "Missed by Patient", "required": False, "display_order": 25},
        {"field_key": "execution_missed_technical_label", "field_type": "text", "label": "Missed Technical — Label", "placeholder": "Missed Technical", "required": False, "display_order": 26},

        # Live / Call Stage
        {"field_key": "livecall_stage_visible", "field_type": "toggle", "label": "Show Live / Call Stage", "required": False, "display_order": 30},
        {"field_key": "livecall_stage_label", "field_type": "text", "label": "Live / Call Stage Label", "placeholder": "Live / Call Stage", "required": False, "display_order": 31},
        {"field_key": "livecall_total_label", "field_type": "text", "label": "Total Attended — Label", "placeholder": "Total Attended", "required": False, "display_order": 32},
        {"field_key": "livecall_video_label", "field_type": "text", "label": "Video Call — Label", "placeholder": "Video Call by Doctor", "required": False, "display_order": 33},
        {"field_key": "livecall_audio_label", "field_type": "text", "label": "Audio Call — Label", "placeholder": "Audio Call by Doctor", "required": False, "display_order": 34},
        {"field_key": "livecall_video_audio_label", "field_type": "text", "label": "Video+Audio Both — Label", "placeholder": "Video+Audio Both", "required": False, "display_order": 35},
        {"field_key": "livecall_chat_label", "field_type": "text", "label": "Chat — Label", "placeholder": "Chat by Doctor", "required": False, "display_order": 36},

        # Delivery / Prescription (placeholder for future)
        {"field_key": "delivery_stage_visible", "field_type": "toggle", "label": "Show Delivery / Prescription Stage", "required": False, "display_order": 40},
        {"field_key": "delivery_stage_label", "field_type": "text", "label": "Delivery Stage Label", "placeholder": "Delivery / Prescription", "required": False, "display_order": 41},

        # Doctor in Camp (placeholder for future)
        {"field_key": "camp_stage_visible", "field_type": "toggle", "label": "Show Doctor in Camp Stage", "required": False, "display_order": 50},
        {"field_key": "camp_stage_label", "field_type": "text", "label": "Doctor in Camp Label", "placeholder": "Doctor in Camp", "required": False, "display_order": 51},

        # Login Report (placeholder for future)
        {"field_key": "login_report_visible", "field_type": "toggle", "label": "Show Login Report Stage", "required": False, "display_order": 60},
        {"field_key": "login_report_label", "field_type": "text", "label": "Login Report Label", "placeholder": "Login Report", "required": False, "display_order": 61},
    ],

    # ── Treatable Symptoms ─────────────────────────────────────────
    "treatable_symptoms": [
        {"field_key": "symptoms_section_label", "field_type": "text", "label": "Section Label", "placeholder": "Symptoms I Treat", "required": False, "display_order": 1},
        {"field_key": "symptoms_helper_text", "field_type": "text", "label": "Helper Text", "placeholder": "Select the symptoms you specialise in treating", "required": False, "display_order": 2},
        {"field_key": "allow_custom_symptoms", "field_type": "toggle", "label": "Allow Custom Symptoms", "helper_text": "Let doctors suggest symptoms not in the master list", "required": False, "display_order": 3},
    ],
}
