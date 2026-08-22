"""Doctor Signup — per-module lifecycle service (Round 9, Phase 3)."""
from __future__ import annotations

from app.common.module_lifecycle import ModuleLifecycle, build_lifecycle
from app.api.doctor_signup_config.modules import (
    MODULE_TO_SECTIONS, MODULE_KEYS,
)
from app.api.doctor_signup_config.default_fields import (
    DOCTOR_SIGNUP_FIELDS,
)
from app.models import PageType


PAGE_TYPE = PageType.DOCTOR_SIGNUP
PAGE_TYPE_STR = 'doctor_signup'


def for_module(module: str) -> ModuleLifecycle:
    return build_lifecycle(
        page_type=PAGE_TYPE,
        page_type_str=PAGE_TYPE_STR,
        module=module,
        module_to_sections=MODULE_TO_SECTIONS,
        default_fields=DOCTOR_SIGNUP_FIELDS,
    )


def list_modules() -> tuple[str, ...]:
    return MODULE_KEYS
