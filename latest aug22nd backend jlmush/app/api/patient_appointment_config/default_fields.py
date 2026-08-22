"""
Default sections and field definitions for the Patient Appointment page configuration.

Mirrors the patient profile config structure:
    - PATIENT_APPOINTMENT_SECTIONS: section-level metadata (label, order, visibility)
    - PATIENT_APPOINTMENT_FIELDS: field-level metadata keyed by section
"""

# ─────────────────────────────────────────────────────────────────────────────
# Section Definitions (stored as PageConfig.fields JSON)
# ─────────────────────────────────────────────────────────────────────────────

PATIENT_APPOINTMENT_SECTIONS = [
    {"key": "filter_general", "label": "General Filters", "display_order": 1, "is_present": True},
    {"key": "filter_preferences", "label": "Preference Filters", "display_order": 2, "is_present": True},
    {"key": "symptoms_display", "label": "Symptoms Display Settings", "display_order": 3, "is_present": True},
    {"key": "symptoms_categories", "label": "Symptom Categories", "display_order": 4, "is_present": True},
]


# ─────────────────────────────────────────────────────────────────────────────
# Field Definitions (stored as PatientAppointmentFieldConfig rows)
# ─────────────────────────────────────────────────────────────────────────────

PATIENT_APPOINTMENT_FIELDS = {
    # ── General Filters ──────────────────────────────────────────
    "filter_general": [
        {"field_key": "gender", "field_type": "multi_select", "label": "Doctor Gender", "display_order": 1, "is_present": True, "options": [{"value": "male", "label": "Male"}, {"value": "female", "label": "Female"}, {"value": "other", "label": "Other"}]},
        {"field_key": "language", "field_type": "multi_select", "label": "Language", "display_order": 2, "is_present": True, "data_source": "languages"},
        {"field_key": "specialization", "field_type": "multi_select", "label": "Specialization", "display_order": 3, "is_present": True, "data_source": "category:specialization"},
        {"field_key": "experience_range", "field_type": "range", "label": "Experience (Years)", "display_order": 4, "is_present": True, "options": {"min": 0, "max": 50, "step": 1}},
        {"field_key": "price_range", "field_type": "range", "label": "Consultation Fee Range", "display_order": 5, "is_present": True, "options": {"min": 0, "max": 5000, "step": 100}},
    ],

    # ── Preference Filters ────────────────────────────────────────
    "filter_preferences": [
        {"field_key": "availability", "field_type": "checkbox_group", "label": "Availability", "display_order": 1, "is_present": True, "options": [{"value": "today", "label": "Available Today"}, {"value": "tomorrow", "label": "Available Tomorrow"}, {"value": "this_week", "label": "This Week"}]},
        {"field_key": "consultation_type", "field_type": "multi_select", "label": "Consultation Type", "display_order": 2, "is_present": True, "options": [{"value": "video", "label": "Video"}, {"value": "audio", "label": "Audio"}, {"value": "chat", "label": "Chat"}, {"value": "in_person", "label": "In-Person"}]},
        {"field_key": "rating", "field_type": "range", "label": "Minimum Rating", "display_order": 3, "is_present": True, "options": {"min": 0, "max": 5, "step": 0.5}},
        {"field_key": "sort_by", "field_type": "select", "label": "Default Sort", "display_order": 4, "is_present": True, "options": [{"value": "relevance", "label": "Relevance"}, {"value": "price_low", "label": "Price: Low to High"}, {"value": "price_high", "label": "Price: High to Low"}, {"value": "experience", "label": "Experience"}, {"value": "rating", "label": "Rating"}]},
    ],

    # ── Symptoms Display Settings ─────────────────────────────────
    "symptoms_display": [
        {"field_key": "max_symptoms", "field_type": "number", "label": "Max Symptoms Selectable", "display_order": 1, "is_present": True, "placeholder": "e.g., 10", "options": {"default": 10}},
        {"field_key": "show_categories", "field_type": "select", "label": "Show Categories", "display_order": 2, "is_present": True, "options": [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]},
        {"field_key": "allow_custom_symptoms", "field_type": "select", "label": "Allow Custom Symptoms", "display_order": 3, "is_present": True, "options": [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]},
        {"field_key": "search_enabled", "field_type": "select", "label": "Enable Symptom Search", "display_order": 4, "is_present": True, "options": [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]},
    ],

    # ── Symptom Categories ────────────────────────────────────────
    "symptoms_categories": [
        {"field_key": "general", "field_type": "checkbox_group", "label": "General / Common", "display_order": 1, "is_present": True},
        {"field_key": "respiratory", "field_type": "checkbox_group", "label": "Respiratory", "display_order": 2, "is_present": True},
        {"field_key": "digestive", "field_type": "checkbox_group", "label": "Digestive", "display_order": 3, "is_present": True},
        {"field_key": "neurological", "field_type": "checkbox_group", "label": "Neurological", "display_order": 4, "is_present": True},
        {"field_key": "musculoskeletal", "field_type": "checkbox_group", "label": "Musculoskeletal", "display_order": 5, "is_present": True},
        {"field_key": "skin", "field_type": "checkbox_group", "label": "Skin & Hair", "display_order": 6, "is_present": True},
        {"field_key": "mental_health", "field_type": "checkbox_group", "label": "Mental Health", "display_order": 7, "is_present": True},
    ],
}
