"""
Data source resolver for dropdown fields in Doctor Profile configuration.

Supports:
    - "category:<type>"            → Category table filtered by category_type
    - "master_colleges"            → MasterCollege table
    - "master_states"              → Static Indian states list (can be replaced by DB table later)
    - "master_universities"        → Category with category_type='university'
    - "master_degrees"             → Category with category_type='degree'
    - "master_religions"           → Static religions list
    - "master_categories"          → Static social categories (General, OBC, SC, ST, Other)
    - "master_languages"           → Static languages list
    - "master_evaluation_criteria" → Static evaluation criteria list
"""

# ---------------------------------------------------------------------------
# Static data (can be migrated to DB tables later via admin CRUD)
# ---------------------------------------------------------------------------
INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
    "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry",
    "Chandigarh", "Andaman and Nicobar Islands", "Dadra and Nagar Haveli and Daman and Diu",
    "Lakshadweep",
]

SOCIAL_CATEGORIES = ["General", "OBC", "SC", "ST", "Other"]

RELIGIONS = [
    "Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Parsi", "Other",
]

LANGUAGES = [
    "English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam", "Marathi",
    "Bengali", "Gujarati", "Odia", "Punjabi", "Urdu", "Assamese", "Sanskrit",
]

EVALUATION_CRITERIA = [
    "Percentage", "CGPA", "GPA", "Class / Division", "Grade",
]


def _static_options(items):
    """Convert a flat list of strings into [{id, name}, …] format."""
    return [{"id": v.lower().replace(" ", "_"), "name": v} for v in items]


def resolve_data_source(source):
    """
    Resolve a data_source string to actual dropdown option values.

    Returns:
        list of dicts: [{"id": "...", "name": "..."}, ...]
    """
    if not source:
        return []

    # Tenant-scope every dynamic lookup. ``Category`` and ``MasterCollege``
    # both extend ``TenantMixin`` — querying them without a tenant filter
    # returns rows from every tenant (and inserts via these models fail the
    # NOT NULL constraint). ``current_tenant_id_or_default`` lets the
    # public, unauthenticated config endpoint fall back to the default
    # tenant when no JWT / X-Tenant-Slug is present.
    from app.common.tenant_context import current_tenant_id_or_default
    tid = current_tenant_id_or_default()

    # Pre-extract the optional ``:level`` qualifier from
    # ``master_<kind>:<level>`` source strings so each branch below
    # can filter by it. ``level=None`` means "no level filter — return
    # everything regardless of qualification_level". Matches the
    # doctor_signup_config resolver's behaviour (see
    # ``doctor_signup_config/data_resolver.py``).
    base_source, _, level_suffix = source.partition(":")
    level = level_suffix if level_suffix in ('ug', 'pg', 'super_speciality') else None

    # ── Dynamic: Category subtypes (kept for back-compat) ──────────
    # Old default_fields used ``category:specialization`` etc. The
    # newer level-scoped key is ``master_specializations:<level>``
    # below — both resolve to the same Category rows so existing
    # tenant configs that haven't been updated still work.
    if source.startswith("category:"):
        category_type = source.split(":", 1)[1]
        from app.models import Category
        items = Category.query.filter_by(
            tenant_id=tid,
            category_type=category_type,
            is_active=True,
        ).order_by(Category.name).all()
        return [{"id": str(c.id), "name": c.name} for c in items]

    # ── Dynamic: Master Colleges (optionally level-scoped) ─────────
    if base_source == "master_colleges":
        from app.models import MasterCollege
        q = MasterCollege.query.filter_by(tenant_id=tid, is_active=True)
        if level:
            # Match the level OR legacy NULL-level rows so colleges
            # added before the level column existed still appear.
            from sqlalchemy import or_
            q = q.filter(or_(
                MasterCollege.qualification_level == level,
                MasterCollege.qualification_level.is_(None),
            ))
        items = q.order_by(MasterCollege.name).all()
        return [{"id": str(c.id), "name": c.name} for c in items]

    # ── Dynamic via Category: Universities ─────────────────────────
    if base_source == "master_universities":
        from app.models import Category
        q = Category.query.filter_by(
            tenant_id=tid, category_type="university", is_active=True,
        )
        if level:
            from sqlalchemy import or_
            q = q.filter(or_(
                Category.qualification_level == level,
                Category.qualification_level.is_(None),
            ))
        items = q.order_by(Category.name).all()
        return [{"id": str(c.id), "name": c.name} for c in items]

    # ── Dynamic via Category: Degrees ──────────────────────────────
    if base_source == "master_degrees":
        from app.models import Category
        q = Category.query.filter_by(
            tenant_id=tid, category_type="degree", is_active=True,
        )
        if level:
            from sqlalchemy import or_
            q = q.filter(or_(
                Category.qualification_level == level,
                Category.qualification_level.is_(None),
            ))
        items = q.order_by(Category.name).all()
        return [{"id": str(c.id), "name": c.name} for c in items]

    # ── Dynamic via Category: Specializations (level-scoped) ───────
    if base_source == "master_specializations":
        from app.models import Category
        q = Category.query.filter_by(
            tenant_id=tid, category_type="specialization", is_active=True,
        )
        if level:
            from sqlalchemy import or_
            q = q.filter(or_(
                Category.qualification_level == level,
                Category.qualification_level.is_(None),
            ))
        items = q.order_by(Category.name).all()
        return [{"id": str(c.id), "name": c.name} for c in items]

    # ── Static lists ───────────────────────────────────────────────
    static_map = {
        "master_states": INDIAN_STATES,
        "master_categories": SOCIAL_CATEGORIES,
        "master_religions": RELIGIONS,
        "master_languages": LANGUAGES,
        "master_evaluation_criteria": EVALUATION_CRITERIA,
    }
    if source in static_map:
        return _static_options(static_map[source])

    return []
