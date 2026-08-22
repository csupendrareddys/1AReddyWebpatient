"""Patient Profile — section → module mapping (Round 9, Phase 1).

Patient profile splits along clinical lines: identity / contact info,
emergency + insurance metadata, health vitals (vitals + habits +
surgeries + female health), document store, family/house group.

See ``docs/features/08-configuration-system/per-module-publish-design.md``.
"""
from __future__ import annotations


MODULE_TO_SECTIONS: dict[str, list[str]] = {
    'personal_contact': [
        'personal_details',
        'contact_identity',
        'address',
    ],
    'emergency_insurance': [
        'emergency_contact',
        'insurance',
    ],
    'health': [
        'vitals',
        'habits',
        'surgeries',
        'female_health',
    ],
    'records': [
        'health_records',
        'previous_prescriptions',
    ],
    'family': [
        'house_family_group',
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
