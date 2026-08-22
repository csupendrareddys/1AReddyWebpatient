"""Guard test — every custom ``X-*`` header the frontend axios interceptor
adds MUST appear in the backend CORS ``allow_headers`` list, otherwise the
browser preflight rejects the request and axios reports "Network Error".

This has bitten the project twice (once on ``X-Tenant-Slug``, once on
``X-Tenant-Host``). Enforce the pairing at CI time so the next person who
adds a custom header is forced to update both ends.

The test parses both files as text rather than importing them — keeps it
fast and avoids pulling in the React build in a Python test.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
AXIOS_CONFIG = REPO_ROOT / 'Frontend' / 'src' / 'api' / 'axiosConfig.js'
EXTENSIONS_PY = REPO_ROOT / 'Backend' / 'app' / 'extensions.py'


def _frontend_custom_headers() -> set[str]:
    """All ``config.headers['X-...']`` keys assigned in axiosConfig.js."""
    if not AXIOS_CONFIG.exists():
        pytest.skip(f"axiosConfig.js not found at {AXIOS_CONFIG}")
    text = AXIOS_CONFIG.read_text(encoding='utf-8')
    # Matches: config.headers['X-Foo'] = ...   /   config.headers["X-Foo"] = ...
    pattern = re.compile(r"""config\.headers\[\s*['"](X-[A-Za-z0-9-]+)['"]\s*\]""")
    return {m.group(1) for m in pattern.finditer(text)}


def _backend_allow_headers() -> set[str]:
    """The ``allow_headers`` list in the Flask-CORS init."""
    text = EXTENSIONS_PY.read_text(encoding='utf-8')
    # Matches the multi-element list inside "allow_headers": [...]
    block = re.search(r'"allow_headers"\s*:\s*\[([^\]]+)\]', text)
    if not block:
        pytest.fail("Could not locate allow_headers list in extensions.py")
    items = re.findall(r'"([^"]+)"', block.group(1))
    return set(items)


def test_every_frontend_x_header_is_in_backend_cors_allow_list():
    fe = _frontend_custom_headers()
    be = _backend_allow_headers()
    missing = fe - be
    assert not missing, (
        f"Frontend axiosConfig.js sets these custom headers that the backend "
        f"CORS allow_headers list does NOT permit: {sorted(missing)}.\n"
        f"Browser preflight will reject; axios will surface as 'Network Error'.\n"
        f"Add the missing header(s) to "
        f"app/extensions.py → cors.init_app(..., allow_headers=[...]).\n"
        f"Frontend headers detected: {sorted(fe)}\n"
        f"Backend allow_headers:     {sorted(be)}"
    )
