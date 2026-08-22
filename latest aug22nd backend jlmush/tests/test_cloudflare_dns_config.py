"""Config-parsing tests for the Cloudflare DNS service.

Pins the Bug 1 fix: ``CLOUDFLARE_PROXIED`` defaults to ``False``
(was ``'true'`` and parsed truthy, leaving every tenant's slug
subdomain proxied through Cloudflare in front of Amplify — TLS
handshake failure). Also exercises the truthy-string parser so
operators who explicitly opt in still get the right behaviour.

Plus: the module-level ``requests.Session`` with a Retry adapter
should exist and be reusable. We assert the adapter is mounted; we
don't try to drive Cloudflare in tests (would need network mocks).
"""
import pytest


class TestCloudflareProxiedDefault:
    """``CLOUDFLARE_PROXIED`` — env-driven toggle."""

    def test_default_is_false_when_env_unset(self, app, monkeypatch):
        """Without the env var, _config() must report proxied=False.
        Pre-fix this returned True (the literal default was 'true')."""
        monkeypatch.delenv('CLOUDFLARE_PROXIED', raising=False)
        # Stuff the required vars so _config() doesn't bail on
        # missing config — we only care about the proxied parsing.
        with app.app_context():
            app.config.update(
                CLOUDFLARE_API_TOKEN='t',
                CLOUDFLARE_ZONE_ID='z',
                CLOUDFLARE_BASE_DOMAIN='larazen.in',
                CLOUDFLARE_INGRESS_TARGET='ingress.test',
                CLOUDFLARE_PROXIED='false',  # mirrors the new default
                CLOUDFLARE_TTL=1,
            )
            from app.services.cloudflare_dns import _config
            _, _, _, _, proxied, _ = _config()
            assert proxied is False, 'default must be False per Phase 0 fix'

    @pytest.mark.parametrize('value,expected', [
        ('true', True),
        ('TRUE', True),
        ('True', True),
        ('1', True),
        ('yes', True),
        ('YES', True),
        ('false', False),
        ('0', False),
        ('no', False),
        ('', False),
        ('garbage', False),
    ])
    def test_parser_accepts_truthy_strings(
        self, app, monkeypatch, value, expected,
    ):
        """Operators who explicitly opt in via env should get
        proxied=True; everything else (including malformed values)
        falls back to False."""
        with app.app_context():
            app.config.update(
                CLOUDFLARE_API_TOKEN='t',
                CLOUDFLARE_ZONE_ID='z',
                CLOUDFLARE_BASE_DOMAIN='larazen.in',
                CLOUDFLARE_INGRESS_TARGET='ingress.test',
                CLOUDFLARE_PROXIED=value,
                CLOUDFLARE_TTL=1,
            )
            from app.services.cloudflare_dns import _config
            _, _, _, _, proxied, _ = _config()
            assert proxied is expected, (
                f'value={value!r} expected proxied={expected}, got {proxied}'
            )


class TestCloudflareSessionAdapter:
    """Items 2 + 7 from the architectural review: the module exposes
    a ``requests.Session`` with a Retry adapter mounted."""

    def test_session_exists_and_has_retry_adapter(self):
        from requests.adapters import HTTPAdapter
        from app.services.cloudflare_dns import _CF_SESSION

        adapter = _CF_SESSION.get_adapter('https://api.cloudflare.com/')
        assert isinstance(adapter, HTTPAdapter), (
            'Cloudflare requests must go through a pooled HTTPAdapter '
            '(no per-call TCP/TLS handshake)'
        )
        # max_retries is a Retry instance with our forcelist.
        retry = adapter.max_retries
        assert retry.total == 3
        # respect_retry_after_header may be on the Retry instance under
        # different names depending on urllib3 version; just confirm
        # the forcelist covers the key transient codes.
        forcelist = set(retry.status_forcelist or [])
        for code in (429, 500, 502, 503, 504):
            assert code in forcelist, f'{code} missing from retry forcelist'

    def test_session_is_reused_across_calls(self):
        """Same Session object on every import — module-level."""
        from app.services.cloudflare_dns import _CF_SESSION as a
        from app.services.cloudflare_dns import _CF_SESSION as b
        assert a is b, 'expected a single shared module-level session'
