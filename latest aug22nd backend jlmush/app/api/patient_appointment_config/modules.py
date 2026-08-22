"""Patient Appointment — section → module mapping (Round 9, Phase 1).

Unlike the other four page_types, the appointment surface is split
into TWO sibling PageType enum values that share a directory:
``PATIENT_APPOINTMENT_FILTER`` (search-filter knobs) and
``PATIENT_APPOINTMENT_SYMPTOMS`` (symptoms picker on the booking
flow). Each lives as its own PageConfig row and therefore gets its
own per-module breakdown.

We surface that explicitly via ``MODULES_BY_PAGE_TYPE`` so the
Phase 3 service layer can ask "what modules does this page have?"
without re-deriving it from section names. The flat
``MODULE_TO_SECTIONS`` and ``SECTION_TO_MODULE`` views are kept for
callers that don't care about the page-type split (section names
are globally unique across the two pages, so the flat view is
unambiguous).

See ``docs/features/08-configuration-system/per-module-publish-design.md``.
"""
from __future__ import annotations


MODULES_BY_PAGE_TYPE: dict[str, dict[str, list[str]]] = {
    'patient_appointment_filter': {
        'filters': [
            'filter_general',
            'filter_preferences',
        ],
    },
    'patient_appointment_symptoms': {
        'symptoms': [
            'symptoms_categories',
            'symptoms_display',
        ],
    },
}


MODULE_TO_SECTIONS: dict[str, list[str]] = {
    module: sections
    for page_modules in MODULES_BY_PAGE_TYPE.values()
    for module, sections in page_modules.items()
}

SECTION_TO_MODULE: dict[str, str] = {
    section: module
    for module, sections in MODULE_TO_SECTIONS.items()
    for section in sections
}

MODULE_KEYS: tuple[str, ...] = tuple(sorted(MODULE_TO_SECTIONS.keys()))


def module_for_section(section: str) -> str | None:
    return SECTION_TO_MODULE.get(section)


def modules_for_page_type(page_type: str) -> tuple[str, ...]:
    """Return the modules that belong to a given page_type.

    ``page_type`` is the lowercase string (e.g.
    ``'patient_appointment_filter'``), matching ``PageType.value``.
    Returns an empty tuple for unknown page_types.
    """
    return tuple(MODULES_BY_PAGE_TYPE.get(page_type, {}).keys())
