"""Patient Appointment — per-module lifecycle service (Round 9, Phase 3).

Unlike the other four page_types, patient_appointment is split into
TWO PageType enum values (``PATIENT_APPOINTMENT_FILTER`` and
``PATIENT_APPOINTMENT_SYMPTOMS``) that share a directory. Each
carries its own modules:

  * FILTER   → 'filters'  (one module — covers filter_general + filter_preferences)
  * SYMPTOMS → 'symptoms' (one module — covers symptoms_categories + symptoms_display)

The ``for_module(page_type_str, module)`` helper routes to the right
PageType + MODULES_BY_PAGE_TYPE entry.
"""
from __future__ import annotations

from app.common.module_lifecycle import ModuleLifecycle, build_lifecycle
from app.api.patient_appointment_config.modules import (
    MODULES_BY_PAGE_TYPE,
)
from app.api.patient_appointment_config.default_fields import (
    PATIENT_APPOINTMENT_FIELDS,
)
from app.models import PageType


_PAGE_TYPE_ENUM_FOR_STR = {
    'patient_appointment_filter': PageType.PATIENT_APPOINTMENT_FILTER,
    'patient_appointment_symptoms': PageType.PATIENT_APPOINTMENT_SYMPTOMS,
}


def _modules_for(page_type_str: str) -> dict[str, list[str]]:
    return MODULES_BY_PAGE_TYPE.get(page_type_str, {})


def for_module(page_type_str: str, module: str) -> ModuleLifecycle:
    """Build a lifecycle for either FILTER or SYMPTOMS + module."""
    enum_val = _PAGE_TYPE_ENUM_FOR_STR.get(page_type_str)
    if enum_val is None:
        raise ValueError(
            f"Unknown patient_appointment page_type '{page_type_str}'. "
            f"Expected one of: {list(_PAGE_TYPE_ENUM_FOR_STR.keys())}"
        )
    module_map = _modules_for(page_type_str)
    return build_lifecycle(
        page_type=enum_val,
        page_type_str=page_type_str,
        module=module,
        module_to_sections=module_map,
        default_fields=PATIENT_APPOINTMENT_FIELDS,
    )


def list_modules(page_type_str: str) -> tuple[str, ...]:
    return tuple(sorted(_modules_for(page_type_str).keys()))
