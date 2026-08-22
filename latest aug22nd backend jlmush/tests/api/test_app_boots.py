"""Cheapest possible smoke test — does the app even boot?

If any of the following are broken, this test fails before the slower
DB-backed tests even start:

  * a model has a syntax error / circular import
  * a blueprint registration crashes
  * a route decorator references something that doesn't exist
  * the CSRF / JWT / RBAC middleware is mis-wired

This is the test that would have caught the "backend not up" regression
without needing any tenant fixtures — it doesn't even need a database
connection.
"""
import pytest


def test_app_imports_cleanly():
    """The most basic check possible: can we import the app factory?

    A failure here usually means a model file or a blueprint module has a
    SyntaxError, an unresolved import, or a SQLAlchemy registry conflict
    (two models with the same ``__tablename__``).
    """
    from app import create_app  # noqa: F401  — import side-effects ARE the test


def test_app_factory_returns_a_flask_app(app):
    """Use the session-scoped ``app`` fixture from conftest. If it yielded,
    create_app + db.create_all + the test config all succeeded.
    """
    from flask import Flask
    assert isinstance(app, Flask)


def test_root_health_endpoint(client):
    """Hit a route that's always public + always present so we know the
    HTTP layer is alive. We accept any 2xx / 3xx / 404 response — the only
    failure here is a 500 (or a connection refused, which would be a test
    runner failure).
    """
    resp = client.get('/')
    assert resp.status_code < 500, (
        f'root request 500-ed — app booted but something in the request '
        f'pipeline crashes: {resp.get_data(as_text=True)[:300]}'
    )


@pytest.mark.parametrize('path', [
    '/api/v1/landing/public',
    '/api/v1/landing/public/recognitions',
    '/api/v1/landing/public/videos',
    # Public anonymous-booking surface — added 2026-04-30. These get hit on
    # every visitor's landing-page load (or when they click a consultation
    # type card) so they need to be 200-or-empty, never 500.
    '/api/v1/public/booking/specializations',
    '/api/v1/public/booking/doctors',
])
def test_critical_public_endpoints_do_not_500(client, path):
    """Each of these is hit on every public landing-page load. A 500 here
    means production pages will look broken and console.error spam will
    flood logs / monitoring.
    """
    resp = client.get(path)
    assert resp.status_code < 500, (
        f'{path} returned {resp.status_code}: '
        f'{resp.get_data(as_text=True)[:300]}'
    )
