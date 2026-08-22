"""
Data source resolver for dropdown fields in Patient Appointment configuration.

Supports:
    - "languages"                   -> INDIAN_LANGUAGES from model.py
    - "symptoms"                    -> Symptom model query
    - "category:<type>"             -> Category table filtered by category_type
"""

from app.models import INDIAN_LANGUAGES


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

    # Tenant-scope every dynamic lookup. Uses ``current_tenant_id_or_default``
    # so the public (anonymous) config endpoint still resolves dropdowns
    # against the default tenant when the request lacks a JWT / X-Tenant-Slug.
    from app.common.tenant_context import current_tenant_id_or_default
    tid = current_tenant_id_or_default()

    # ── Dynamic: Category subtypes ─────────────────────────────────
    if source.startswith("category:"):
        category_type = source.split(":", 1)[1]
        from app.models import Category
        items = Category.query.filter_by(
            tenant_id=tid,
            category_type=category_type,
            is_active=True,
        ).order_by(Category.name).all()
        return [{"id": str(c.id), "name": c.name} for c in items]

    # ── Indian Languages (with native script) ──────────────────────
    if source == "languages":
        return [
            {"id": lang['code'], "name": lang['name'], "native": lang['native']}
            for lang in INDIAN_LANGUAGES
        ]

    # ── Symptoms from DB ──────────────────────────────────────────
    if source == "symptoms":
        try:
            from app.models import Symptom
            items = Symptom.query.filter_by(
                tenant_id=tid, is_active=True,
            ).order_by(Symptom.name).all()
            return [{"id": str(s.id), "name": s.name, "category": getattr(s, 'category', None)} for s in items]
        except Exception:
            return []

    return []
