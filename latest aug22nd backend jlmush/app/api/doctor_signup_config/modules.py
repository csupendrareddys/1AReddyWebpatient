"""Doctor Signup — section → module mapping (Round 9, Phase 1).

The signup form has fewer sections than the profile page since it's
the first-time-onboarding surface; modules collapse to 4 groupings.

See ``docs/features/08-configuration-system/per-module-publish-design.md``.
"""
from __future__ import annotations


MODULE_TO_SECTIONS: dict[str, list[str]] = {
    # account-level credentials (email / phone / password + OTP plumbing)
    'account': [
        'account',
    ],
    # name / dob / gender + address fields collapsed into one "identity
    # & contact" block so operators publish them together.
    'identity_contact': [
        'personal',
        'address',
        'identity',
    ],
    'qualifications': [
        'qualifications_ug',
        'qualifications_pg',
        'qualifications_ss',
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
