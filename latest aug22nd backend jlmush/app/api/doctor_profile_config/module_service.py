"""Doctor Profile — per-module lifecycle service (Round 9, Phase 3).

Thin adapter around ``app.common.module_lifecycle.ModuleLifecycle``
that pins the page_type-specific bits (PageType enum, section→module
map, default-fields constant) for ``doctor_profile``. The Phase 3
routes module imports the ``for_module(module_key)`` helper and gets
a ready-to-use lifecycle object back.

Side note on back-compat — the legacy page-wide endpoints
(``/admin/doctor_profile/draft``, ``.../publish``, etc.) keep
working through ``DoctorProfileConfigService``. Per-module endpoints
live under ``/admin/doctor_profile/<module>/...`` and operate
exclusively on ModuleConfig rows. The two surfaces share the same
underlying PageFieldConfig rows (each row carries BOTH ``config_id``
and ``module_config_id`` during the cutover window), so an edit via
either surface lands in both.
"""
from __future__ import annotations

from app.common.module_lifecycle import ModuleLifecycle, build_lifecycle
from app.api.doctor_profile_config.modules import (
    MODULE_TO_SECTIONS, MODULE_KEYS,
)
from app.api.doctor_profile_config.default_fields import (
    DOCTOR_PROFILE_FIELDS,
)
from app.models import PageType


PAGE_TYPE = PageType.DOCTOR_PROFILE
PAGE_TYPE_STR = 'doctor_profile'


def for_module(module: str) -> ModuleLifecycle:
    """Return a lifecycle helper bound to ``doctor_profile/<module>``."""
    return build_lifecycle(
        page_type=PAGE_TYPE,
        page_type_str=PAGE_TYPE_STR,
        module=module,
        module_to_sections=MODULE_TO_SECTIONS,
        default_fields=DOCTOR_PROFILE_FIELDS,
    )


def list_modules() -> tuple[str, ...]:
    """Return the canonical list of module identifiers."""
    return MODULE_KEYS
