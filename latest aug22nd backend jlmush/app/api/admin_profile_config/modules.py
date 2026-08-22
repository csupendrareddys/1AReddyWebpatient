"""Admin Profile — section → module mapping (Round 9, Phase 1).

Mirrors doctor_profile_config/modules.py with admin-side renames
(admin_analytics / admin_attendance instead of doctor_*). The
top-level grouping the editor sidebar renders is identical to
doctor_profile so the two surfaces feel symmetrical to operators.

See ``docs/features/08-configuration-system/per-module-publish-design.md``.
"""
from __future__ import annotations


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
        'admin_analytics',
        'admin_attendance',
    ],
}

SECTION_TO_MODULE: dict[str, str] = {
    section: module
    for module, sections in MODULE_TO_SECTIONS.items()
    for section in sections
}

MODULE_KEYS: tuple[str, ...] = tuple(sorted(MODULE_TO_SECTIONS.keys()))


def module_for_section(section: str) -> str | None:
    return SECTION_TO_MODULE.get(section)
