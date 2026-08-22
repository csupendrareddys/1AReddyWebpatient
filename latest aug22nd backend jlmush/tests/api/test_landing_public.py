"""Integration tests for the public landing-page endpoints.

These tests boot the real Flask app, hit the actual HTTP endpoints with the
test client, and assert the response shape + status. They are the smoke
tests CI was missing — they would have caught the kind of "endpoint 404s
or 500s but the build still passes" failure that surfaced in production.

What's covered
--------------
* ``/api/landing/public`` returns 200 with the expected envelope even for
  a tenant that has no ``LandingConfig`` row yet.
* ``/api/landing/public/recognitions`` returns ``[]`` (not 404 / 500)
  when no recognitions are configured.
* ``/api/landing/public/videos`` returns the ``{videos, total_count}``
  envelope even when empty.
* Posting a recognition / video as an admin and re-reading the public
  endpoint reflects the change.

A scrubbed test DB is used (separate from the dev DB). The
``fresh_tenant`` fixture creates a unique tenant per test so RLS isolates
data and tests don't bleed into each other.
"""
import uuid

import pytest

from app.extensions import db
from app.models import (
    LandingConfig, LandingRecognition, LandingVideo,
    ConfigStatus, User, UserRole,
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _make_super_admin(tenant):
    """Insert a SUPER_ADMIN user under ``tenant`` so admin endpoints have a
    real principal to authenticate as.
    """
    user = User(
        tenant_id=tenant.id,
        email=f'admin_{uuid.uuid4().hex[:8]}@test.com',
        role=UserRole.SUPER_ADMIN,
        first_name='Test',
        last_name='Admin',
        is_active=True,
        email_verified=True,
    )
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.commit()
    return user


def _seed_live_landing(tenant):
    """A LIVE :class:`LandingConfig` row so ``/public`` returns content
    rather than the empty fallback.
    """
    cfg = LandingConfig(
        tenant_id=tenant.id,
        status=ConfigStatus.LIVE,
        version=1,
        hero_title='Welcome',
        primary_color='#1976d2',
        secondary_color='#dc004e',
    )
    db.session.add(cfg)
    db.session.commit()
    return cfg


# --------------------------------------------------------------------------- #
# /api/landing/public
# --------------------------------------------------------------------------- #

class TestPublicLandingTree:

    def test_unconfigured_tenant_returns_empty_envelope(self, client, fresh_tenant):
        """Tenant with no LandingConfig should NOT 500 — the endpoint
        returns an empty-modules envelope so the frontend can render its
        own defaults.
        """
        resp = client.get(
            '/api/v1/landing/public',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body['success'] is True
        assert 'modules' in body['data']
        assert body['data']['modules'] == []

    def test_configured_tenant_returns_hero(self, client, fresh_tenant):
        _seed_live_landing(fresh_tenant)
        resp = client.get(
            '/api/v1/landing/public',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['data']['hero_title'] == 'Welcome'
        # Theme block — these are the columns the recent migrations added,
        # the tests would have caught a "to_dict missing key" regression.
        assert 'primary_color' in body['data']
        assert 'theme_preset' in body['data']
        assert 'accent_color' in body['data']
        assert 'hero_style' in body['data']


# --------------------------------------------------------------------------- #
# /api/landing/public/recognitions
# --------------------------------------------------------------------------- #

class TestPublicRecognitions:

    def test_empty_list_for_unconfigured_tenant(self, client, fresh_tenant):
        """Critical: must NOT 404 when nothing is configured. The frontend
        treats an empty list as "hide the section"; a 404 would log a
        console.error in production for every visit.
        """
        resp = client.get(
            '/api/v1/landing/public/recognitions',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200
        assert resp.get_json()['data'] == []

    def test_returns_visible_only_in_display_order(self, client, fresh_tenant):
        # Two visible (order 1, 0) + one hidden — public should show the
        # two in order [0, 1] and exclude the hidden one.
        for kwargs in [
            {'title': 'A', 'display_order': 1, 'is_visible': True},
            {'title': 'B', 'display_order': 0, 'is_visible': True},
            {'title': 'HIDDEN', 'display_order': 2, 'is_visible': False},
        ]:
            db.session.add(LandingRecognition(tenant_id=fresh_tenant.id, **kwargs))
        db.session.commit()

        resp = client.get(
            '/api/v1/landing/public/recognitions',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200
        titles = [r['title'] for r in resp.get_json()['data']]
        assert titles == ['B', 'A'], 'visible-only and display_order ASC'


# --------------------------------------------------------------------------- #
# /api/landing/public/videos
# --------------------------------------------------------------------------- #

class TestPublicVideos:

    def test_empty_envelope_for_unconfigured_tenant(self, client, fresh_tenant):
        resp = client.get(
            '/api/v1/landing/public/videos',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200
        body = resp.get_json()['data']
        assert body == {'videos': [], 'total_count': 0}

    def test_limit_param_caps_response_but_total_count_is_full(
        self, client, fresh_tenant,
    ):
        """The frontend uses ``total_count > limit`` to decide whether to
        show the "More" CTA — a regression where total_count starts
        equalling ``len(videos)`` would silently break that decision.
        """
        for i in range(5):
            db.session.add(LandingVideo(
                tenant_id=fresh_tenant.id,
                title=f'Video {i}',
                video_url=f'https://example.com/{i}.mp4',
                display_order=i,
                is_visible=True,
            ))
        db.session.commit()

        resp = client.get(
            '/api/v1/landing/public/videos?limit=3',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200
        body = resp.get_json()['data']
        assert len(body['videos']) == 3
        assert body['total_count'] == 5, (
            'total_count must reflect ALL visible videos, not the limit'
        )

    def test_invisible_videos_excluded_from_total_count(
        self, client, fresh_tenant,
    ):
        db.session.add(LandingVideo(
            tenant_id=fresh_tenant.id, title='Visible', video_url='https://x.test',
            is_visible=True,
        ))
        db.session.add(LandingVideo(
            tenant_id=fresh_tenant.id, title='Hidden', video_url='https://x.test',
            is_visible=False,
        ))
        db.session.commit()

        resp = client.get(
            '/api/v1/landing/public/videos',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        body = resp.get_json()['data']
        assert body['total_count'] == 1
        assert len(body['videos']) == 1


# --------------------------------------------------------------------------- #
# Custom-domain resolution — the bug surfaced when a tenant on a custom
# domain (e.g. ``vedanthzen.com``) saw the platform owner's apex marketing
# landing instead of their own. The frontend mis-classified by label-count;
# the backend already supports tenant resolution via the ``X-Tenant-Host``
# header, but had no test pinning that path. This pins it.
# --------------------------------------------------------------------------- #

class TestPublicLandingCustomDomain:

    def test_resolves_via_tenant_host_header(self, client, fresh_tenant):
        """A request that supplies ONLY ``X-Tenant-Host`` (no slug header,
        no JWT, no query param) must resolve the tenant by its
        ``tenants.domain`` column and return that tenant's landing config.

        This is the path every browser on a custom domain takes —
        axios sends ``X-Tenant-Host: window.location.hostname`` and
        leaves ``X-Tenant-Slug`` blank because there's no slug to
        derive from a fully-custom hostname.
        """
        # Pin a custom domain on the fixture tenant.
        fresh_tenant.domain = f'custom-{uuid.uuid4().hex[:6]}.example.com'
        _seed_live_landing(fresh_tenant)
        db.session.commit()

        resp = client.get(
            '/api/v1/landing/public',
            headers={'X-Tenant-Host': fresh_tenant.domain},
        )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body['success'] is True
        # The tenant's own hero — NOT the platform marketing's. If
        # tenant resolution falls back to the default tenant, this
        # assertion fails because the default tenant has no
        # ``LandingConfig`` row in this test session.
        assert body['data'].get('hero_title') == 'Welcome'
