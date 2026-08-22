"""Doctor Profile — section → module mapping (Round 9, Phase 1).

Each module groups one or more ``PageFieldConfig.section`` values
into a single publish unit. The editor sidebar renders one "Controls"
entry per module; Phase 3 endpoints key on these module identifiers.

Modules are intentionally slug-style (lowercase, underscores) so they
read well in URLs (``/admin/doctor_profile/personal_professional/publish``).

See ``docs/features/08-configuration-system/per-module-publish-design.md``
for the full design + open questions answered by the user in Round 9.
"""
from __future__ import annotations

# Module identifier → list of section keys it owns.
# Stays in lock-step with ``default_fields.py``'s DOCTOR_PROFILE_FIELDS
# keys. If a new section is added to default_fields, add it here too
# (and an alarm in tests/api/test_module_mapping.py will flag any
# unmapped section).
MODULE_TO_SECTIONS: dict[str, list[str]] = {
    'personal_professional': [
        'personal_details',
        'additional_personal_details',
        'identity_documents',
        'female_health_details',
    ],
    'addresses': [
        'current_address',
        'permanent_address',
    ],
    'signatures_verification': [
        'signatures',
    ],
    'about_me': [
        'about_me',
    ],
    'education': [
        'education_graduation',
        'education_post_graduation',
        'education_super_speciality',
        'education_other_certification',
    ],
    'bank_details': [
        'bank_details',
    ],
    'declaration_documents': [
        'declaration_documents',
    ],
    'scheduling': [
        'working_days_hours',
        'consultation_pricing',
    ],
    'analytics': [
        'doctor_analytics',
        'doctor_attendance',
    ],
    'treatable_symptoms': [
        'treatable_symptoms',
    ],
}

# Reverse map (computed once at import). Fast lookup
# section_key → module_key during field-row writes.
SECTION_TO_MODULE: dict[str, str] = {
    section: module
    for module, sections in MODULE_TO_SECTIONS.items()
    for section in sections
}

# Canonical list of module keys (sorted for stable iteration).
MODULE_KEYS: tuple[str, ...] = tuple(sorted(MODULE_TO_SECTIONS.keys()))


def module_for_section(section: str) -> str | None:
    """Return the module that owns the given section, or None if the
    section isn't mapped. None signals "unowned" — the caller should
    skip the row rather than guess (Phase 2 migration treats unmapped
    sections as orphans and logs them)."""
    return SECTION_TO_MODULE.get(section)
