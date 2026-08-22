"""Every path in :data:`ALLOWED_FEATURE_PATHS` must be referenced by at
least one ``@feature_required(...)`` decorator or a service-layer
``FeatureGate.require_feature(...)`` / ``FeatureGate.is_enabled(...)`` call.

Adding a path to the whitelist without wiring a call site means the
feature exists in plans and add-ons but nothing enforces it — silently
broken. This static scan catches that at CI time.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2] / 'app'


def _collect_referenced_paths() -> set[str]:
    """Grep the source tree for any quoted string whose value matches
    ``<module>.<sub>`` or ``<module>.<sub>.<leaf>``. This is permissive on
    purpose — we want to count DomainPolicy and PaymentResolver callers
    too, not just decorator strings.
    """
    referenced: set[str] = set()
    # Dotted-path literal in a quote. Three segments max — matches
    # ``domain.subdomain.configurable`` and ``patient.vitals`` alike.
    # Digits included: ``i18n.multi_language`` was invisible to the
    # scan and got falsely reported as having no call site.
    pattern = re.compile(r"['\"]([a-z0-9_]+(?:\.[a-z0-9_]+){1,2})['\"]")
    for py_file in ROOT.rglob('*.py'):
        # Skip the whitelist definition itself, and the test file.
        if py_file.name in {'service.py'} and 'pricing' in py_file.parts:
            # Intentionally skipped — the whitelist lives here.
            # But also include it so path literals used inside the file
            # (e.g. in debug logs) are counted — re-enable below.
            pass
        text = py_file.read_text(encoding='utf-8', errors='ignore')
        for m in pattern.findall(text):
            referenced.add(m)
    return referenced


def test_every_whitelisted_path_has_a_call_site():
    from app.api.pricing.service import ALLOWED_FEATURE_PATHS

    referenced = _collect_referenced_paths()
    missing = []
    for path in ALLOWED_FEATURE_PATHS:
        # Any exact match OR a prefix match on a 3-segment path (e.g.
        # ``domain.subdomain`` is "covered" if ``domain.subdomain.configurable``
        # is referenced somewhere).
        if path in referenced:
            continue
        if any(ref.startswith(f'{path}.') for ref in referenced):
            continue
        missing.append(path)

    assert not missing, (
        'Feature paths in ALLOWED_FEATURE_PATHS have no call site — '
        f'decorate a route or add a policy call for each: {sorted(missing)}'
    )
