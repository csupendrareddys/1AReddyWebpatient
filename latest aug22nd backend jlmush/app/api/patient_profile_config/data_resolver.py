"""
Data source resolver for dropdown fields in Patient Profile configuration.

Supports:
    - "indian_languages"            -> INDIAN_LANGUAGES from model.py
    - "blood_groups"                -> Static blood groups
    - "master_states"               -> Static Indian states
    - "master_religions"            -> Static religions
    - "master_categories"           -> Static social categories
    - "gender_options"              -> Gender options
    - "relation_types"              -> Family relation types
    - "habit_types"                 -> Habit categories
    - "surgery_types"               -> Common surgery types
    - "record_types"                -> Health record types
    - "insurance_providers"         -> Insurance provider list
    - "pregnancy_status"            -> Pregnancy status options
    - "category:<type>"             -> Category table filtered by category_type
"""

from app.models import INDIAN_LANGUAGES

# ---------------------------------------------------------------------------
# Static data
# ---------------------------------------------------------------------------
INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
    "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry",
    "Chandigarh", "Andaman and Nicobar Islands",
    "Dadra and Nagar Haveli and Daman and Diu", "Lakshadweep",
]

BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]

RELIGIONS = [
    "Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Parsi", "Other",
]

SOCIAL_CATEGORIES = ["General", "OBC", "SC", "ST", "Other"]

GENDER_OPTIONS = [
    {"id": "male", "name": "Male"},
    {"id": "female", "name": "Female"},
    {"id": "other", "name": "Other"},
    {"id": "prefer_not_to_say", "name": "Prefer not to say"},
]

RELATION_TYPES = [
    "Spouse", "Father", "Mother", "Son", "Daughter", "Brother", "Sister",
    "Grandfather", "Grandmother", "Grandson", "Granddaughter",
    "Uncle", "Aunt", "Cousin", "Nephew", "Niece",
    "Father-in-law", "Mother-in-law", "Son-in-law", "Daughter-in-law",
    "Friend", "Guardian", "Other",
]

HABIT_TYPES = [
    {"id": "smoking", "name": "Smoking", "options": ["Never", "Occasionally", "Regularly", "Former"]},
    {"id": "alcohol", "name": "Alcohol", "options": ["Never", "Occasionally", "Regularly", "Former"]},
    {"id": "tobacco", "name": "Tobacco (Chewing)", "options": ["Never", "Occasionally", "Regularly", "Former"]},
    {"id": "drugs", "name": "Recreational Drugs", "options": ["Never", "Occasionally", "Regularly", "Former"]},
    {"id": "exercise", "name": "Exercise", "options": ["None", "Light", "Moderate", "Heavy"]},
    {"id": "diet", "name": "Diet", "options": ["Vegetarian", "Non-Vegetarian", "Vegan", "Eggetarian"]},
    {"id": "sleep", "name": "Sleep Pattern", "options": ["<5 hrs", "5-6 hrs", "6-8 hrs", "8+ hrs"]},
    {"id": "caffeine", "name": "Caffeine", "options": ["None", "1-2 cups", "3-4 cups", "5+ cups"]},
]

SURGERY_TYPES = [
    "Appendectomy", "Caesarean Section", "Cholecystectomy (Gallbladder)",
    "Coronary Bypass", "Dental Surgery", "Eye Surgery (LASIK/Cataract)",
    "Hernia Repair", "Hip Replacement", "Hysterectomy",
    "Knee Replacement", "Tonsillectomy", "Fracture Fixation",
    "Angioplasty", "Bariatric Surgery", "Spinal Surgery",
    "Kidney Stone Removal", "Prostatectomy", "Thyroidectomy",
    "Other",
]

RECORD_TYPES = [
    {"id": "vitals", "name": "Vitals"},
    {"id": "lab_report", "name": "Lab Report"},
    {"id": "imaging", "name": "Imaging (X-Ray, MRI, CT)"},
    {"id": "prescription", "name": "Prescription"},
    {"id": "discharge_summary", "name": "Discharge Summary"},
    {"id": "vaccination", "name": "Vaccination Record"},
    {"id": "allergy", "name": "Allergy"},
    {"id": "chronic_condition", "name": "Chronic Condition"},
    {"id": "surgery_record", "name": "Surgery Record"},
    {"id": "other", "name": "Other"},
]

INSURANCE_PROVIDERS = [
    "Star Health", "HDFC ERGO", "ICICI Lombard", "Max Bupa",
    "Care Health", "Bajaj Allianz", "New India Assurance",
    "Oriental Insurance", "United India Insurance", "National Insurance",
    "SBI General", "Tata AIG", "Reliance General", "Niva Bupa",
    "Aditya Birla Health", "Manipal Cigna", "Cholamandalam MS",
    "Royal Sundaram", "Liberty General", "Other",
]

PREGNANCY_STATUS_OPTIONS = [
    {"id": "not_pregnant", "name": "Not Pregnant"},
    {"id": "pregnant", "name": "Pregnant"},
    {"id": "postpartum", "name": "Postpartum"},
    {"id": "trying", "name": "Trying to Conceive"},
    {"id": "na", "name": "Not Applicable"},
]


def _static_options(items):
    """Convert a flat list of strings into [{id, name}, ...] format."""
    return [{"id": v.lower().replace(" ", "_").replace("-", "_"), "name": v} for v in items]


def resolve_data_source(source):
    """
    Resolve a data_source string to actual dropdown option values.

    Returns:
        list of dicts: [{"id": "...", "name": "..."}, ...]
    """
    if not source:
        return []

    # ── Dynamic: Category subtypes ─────────────────────────────────
    # ``Category`` extends ``TenantMixin`` — scope by tenant. Uses
    # ``current_tenant_id_or_default`` so the public (anonymous) config
    # endpoint still resolves dropdowns against the default tenant when
    # the request lacks a JWT / X-Tenant-Slug.
    if source.startswith("category:"):
        category_type = source.split(":", 1)[1]
        from app.models import Category
        from app.common.tenant_context import current_tenant_id_or_default
        items = Category.query.filter_by(
            tenant_id=current_tenant_id_or_default(),
            category_type=category_type,
            is_active=True,
        ).order_by(Category.name).all()
        return [{"id": str(c.id), "name": c.name} for c in items]

    # ── Indian Languages (with native script) ──────────────────────
    if source == "indian_languages":
        return [
            {"id": lang['code'], "name": lang['name'], "native": lang['native']}
            for lang in INDIAN_LANGUAGES
        ]

    # ── Static lists ───────────────────────────────────────────────
    static_map = {
        "master_states": INDIAN_STATES,
        "master_religions": RELIGIONS,
        "master_categories": SOCIAL_CATEGORIES,
        "blood_groups": BLOOD_GROUPS,
        "relation_types": RELATION_TYPES,
        "surgery_types": SURGERY_TYPES,
        "insurance_providers": INSURANCE_PROVIDERS,
    }
    if source in static_map:
        return _static_options(static_map[source])

    # ── Structured static lists (already {id, name} format) ───────
    structured_map = {
        "gender_options": GENDER_OPTIONS,
        "habit_types": HABIT_TYPES,
        "record_types": RECORD_TYPES,
        "pregnancy_status": PREGNANCY_STATUS_OPTIONS,
    }
    if source in structured_map:
        return structured_map[source]

    return []
