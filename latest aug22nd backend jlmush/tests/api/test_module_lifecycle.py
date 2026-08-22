"""Round 9 — per-module publish lifecycle tests.

Phase 3 introduced ``ModuleConfig`` rows that carry per-module
DRAFT / PREVIEW / LIVE state, plus a sibling URL surface at
``/admin/<page_type>/<module>/...``. These tests lock down:

  * Smoke: doctor_profile's per-module endpoints respond with a
    valid envelope under SUPER_ADMIN auth.
  * Lifecycle: DRAFT → PREVIEW → LIVE actually transitions the row
    and bumps the partial-unique-index-protected slot per status.
  * Isolation: publishing one module does NOT touch others —
    crucial because that's the entire reason the refactor exists.
  * Field wiring: PageFieldConfig rows seeded by ``get_or_create_draft``
    end up linked via ``module_config_id`` AND ``config_id`` (back-
    compat window — Phase 5 drops the legacy column).

Mirrors the harness used by the existing config tests
(``test_page_config_public.py``): ``fresh_tenant`` for isolation,
``auth_headers_for_tenant`` for SUPER_ADMIN auth.
"""
from __future__ import annotations

import uuid

import pytest

from app.extensions import db
from app.models import (
    User, UserRole, UserStatus,
    ModuleConfig, PageFieldConfig, ConfigStatus, PageType,
)
from app.models._base import set_tenant_context


@pytest.fixture
def super_admin(app, db_session, fresh_tenant):
    """A SUPER_ADMIN user inside ``fresh_tenant``. Tests bypass the
    page-wide editor entirely — they want a clean tenant per test so
    the partial-unique index doesn't trip on cross-test leakage."""
    set_tenant_context(db.session, fresh_tenant.id)
    email = f'sa_{uuid.uuid4().hex[:8]}@test.com'
    phone = f'9{uuid.uuid4().int % 1000000000:09d}'
    user = User(
        role=UserRole.SUPER_ADMIN,
        first_name='Super',
        last_name='Admin',
        email_verified=True,
        phone_verified=True,
        tenant_id=fresh_tenant.id,
    )
    user.email = email
    user.phone_number = phone
    try:
        user.status = UserStatus.ACTIVE
    except Exception:
        pass
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.commit()
    return user


def _auth(app, user, tenant):
    """Build SUPER_ADMIN headers — wraps the shared helper so each
    test reads cleanly. Imported lazily because the helper lives at
    module-scope in conftest."""
    from tests.conftest import auth_headers_for_tenant, get_auth_headers

    # ``auth_headers_for_tenant`` mints the JWT but skips the
    # UserSession seed that ``get_auth_headers`` does, so use the
    # latter then layer the tenant slug header.
    base = get_auth_headers(app, user)
    base['X-Tenant-Slug'] = tenant.slug
    return base


# ────────────────────────────────────────────────────────────────────
# Smoke tests — endpoints respond, contracts hold
# ────────────────────────────────────────────────────────────────────

class TestSmoke:

    def test_list_modules_returns_canonical_set(
        self, client, app, fresh_tenant, super_admin,
    ):
        """``GET /admin/doctor_profile/modules`` returns the 10
        doctor_profile module identifiers (mirror of MODULE_KEYS in
        doctor_profile_config/modules.py)."""
        resp = client.get(
            '/api/v1/doctor-profile-config/admin/doctor_profile/modules',
            headers=_auth(app, super_admin, fresh_tenant),
        )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body['success'] is True
        modules = [row['module'] for row in body['data']]
        # Spot-check a few — the full list lives in modules.py.
        assert 'education' in modules
        assert 'addresses' in modules
        assert 'analytics' in modules
        assert len(modules) == 10

    def test_unknown_module_404s(self, client, app, fresh_tenant, super_admin):
        resp = client.get(
            '/api/v1/doctor-profile-config/admin/doctor_profile/this_is_not_a_module/draft',
            headers=_auth(app, super_admin, fresh_tenant),
        )
        assert resp.status_code == 404
        body = resp.get_json()
        assert body['success'] is False
        assert 'Unknown module' in body['message']

    def test_get_draft_creates_module_config(
        self, client, app, fresh_tenant, super_admin,
    ):
        """First GET /draft must create the DRAFT ModuleConfig if none
        exists (back-compat with how get_or_create_draft works for
        page-wide configs)."""
        # Pre-condition: no ModuleConfig for this tenant/module.
        set_tenant_context(db.session, fresh_tenant.id)
        existing = ModuleConfig.query.filter_by(
            tenant_id=fresh_tenant.id,
            page_type=PageType.DOCTOR_PROFILE,
            module='education',
        ).count()
        assert existing == 0

        resp = client.get(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/draft',
            headers=_auth(app, super_admin, fresh_tenant),
        )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body['success'] is True
        data = body['data']
        assert data['module'] == 'education'
        assert data['page_type'] == 'doctor_profile'
        assert data['status'] == 'draft'
        assert 'field_configs' in data

        # The row landed in Postgres.
        set_tenant_context(db.session, fresh_tenant.id)
        draft = ModuleConfig.query.filter_by(
            tenant_id=fresh_tenant.id,
            page_type=PageType.DOCTOR_PROFILE,
            module='education',
            status=ConfigStatus.DRAFT,
        ).first()
        assert draft is not None


# ────────────────────────────────────────────────────────────────────
# Lifecycle — DRAFT → PREVIEW → LIVE
# ────────────────────────────────────────────────────────────────────

class TestLifecycle:

    def _create_draft(self, client, app, tenant, user, module='education'):
        resp = client.get(
            f'/api/v1/doctor-profile-config/admin/doctor_profile/{module}/draft',
            headers=_auth(app, user, tenant),
        )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        return resp.get_json()['data']

    def test_promote_to_preview(self, client, app, fresh_tenant, super_admin):
        self._create_draft(client, app, fresh_tenant, super_admin)
        resp = client.post(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/preview',
            headers=_auth(app, super_admin, fresh_tenant),
        )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        data = resp.get_json()['data']
        assert data['status'] == 'preview'

    def test_publish_with_note(self, client, app, fresh_tenant, super_admin):
        self._create_draft(client, app, fresh_tenant, super_admin)
        # DRAFT → PREVIEW
        client.post(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/preview',
            headers=_auth(app, super_admin, fresh_tenant),
        )
        # PREVIEW → LIVE with a note
        resp = client.post(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/publish',
            json={'note': 'Round 9 education module v1'},
            headers=_auth(app, super_admin, fresh_tenant),
        )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        data = resp.get_json()['data']
        assert data['status'] == 'live'
        assert data['note'] == 'Round 9 education module v1'
        assert data['published_at'] is not None

        # History endpoint now surfaces this version + its note.
        hist_resp = client.get(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/history',
            headers=_auth(app, super_admin, fresh_tenant),
        )
        assert hist_resp.status_code == 200
        hist = hist_resp.get_json()['data']
        assert len(hist) == 1
        assert hist[0]['publish_note'] == 'Round 9 education module v1'
        assert hist[0]['status'] == 'live'


# ────────────────────────────────────────────────────────────────────
# Isolation — publishing one module doesn't touch others
# ────────────────────────────────────────────────────────────────────

class TestModuleIsolation:

    def test_publish_education_leaves_addresses_alone(
        self, client, app, fresh_tenant, super_admin,
    ):
        """The whole reason for Round 9 — publishing one module must NOT
        touch siblings. Operator publishes only the education module;
        the addresses module should still have NO LIVE config."""
        auth = _auth(app, super_admin, fresh_tenant)
        # Seed BOTH modules as DRAFT.
        client.get(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/draft',
            headers=auth,
        )
        client.get(
            '/api/v1/doctor-profile-config/admin/doctor_profile/addresses/draft',
            headers=auth,
        )
        # Promote + publish ONLY education.
        client.post(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/preview',
            headers=auth,
        )
        client.post(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/publish',
            json={'note': 'first ed publish'},
            headers=auth,
        )

        # State assertion against the DB directly — avoids any
        # endpoint-level caching that could give a false green.
        set_tenant_context(db.session, fresh_tenant.id)

        ed_live = ModuleConfig.query.filter_by(
            tenant_id=fresh_tenant.id,
            page_type=PageType.DOCTOR_PROFILE,
            module='education',
            status=ConfigStatus.LIVE,
        ).count()
        addr_live = ModuleConfig.query.filter_by(
            tenant_id=fresh_tenant.id,
            page_type=PageType.DOCTOR_PROFILE,
            module='addresses',
            status=ConfigStatus.LIVE,
        ).count()
        addr_draft = ModuleConfig.query.filter_by(
            tenant_id=fresh_tenant.id,
            page_type=PageType.DOCTOR_PROFILE,
            module='addresses',
            status=ConfigStatus.DRAFT,
        ).count()

        assert ed_live == 1, 'education should have exactly one LIVE row'
        assert addr_live == 0, (
            'addresses must have ZERO LIVE rows — publishing education '
            'should not promote sibling modules'
        )
        assert addr_draft == 1, (
            'addresses DRAFT should still be DRAFT — no automatic '
            'lifecycle bump'
        )


# ────────────────────────────────────────────────────────────────────
# Field wiring — DRAFT seeds module_config_id on field rows
# ────────────────────────────────────────────────────────────────────

class TestFieldWiring:

    def test_get_or_create_draft_seeds_field_rows_with_module_fk(
        self, client, app, fresh_tenant, super_admin,
    ):
        """When a fresh tenant calls GET /draft for a module, the
        helper must seed default fields with module_config_id set. The
        legacy config_id column is also populated during the back-
        compat window so the page-wide endpoints keep working."""
        resp = client.get(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/draft',
            headers=_auth(app, super_admin, fresh_tenant),
        )
        assert resp.status_code == 200
        data = resp.get_json()['data']
        draft_id = data['id']

        set_tenant_context(db.session, fresh_tenant.id)
        rows = PageFieldConfig.query.filter_by(
            tenant_id=fresh_tenant.id,
            module_config_id=draft_id,
        ).all()
        assert len(rows) > 0, 'expected default field rows seeded for education'
        for r in rows:
            assert r.module_config_id is not None
            # Back-compat — config_id stays populated during the
            # cutover window (Phase 5 drops it).
            assert r.config_id is not None
            # Sanity — every seeded row should belong to a section
            # that the education module owns.
            assert r.section.startswith('education'), (
                f'unexpected section {r.section} on education module row'
            )


# ────────────────────────────────────────────────────────────────────
# Restore — pull a historical version back into DRAFT
# ────────────────────────────────────────────────────────────────────

class TestRestore:

    def test_restore_history_pulls_into_draft(
        self, client, app, fresh_tenant, super_admin,
    ):
        """Restoring a historical (ARCHIVED) version refreshes the DRAFT
        with that version's contents — does NOT replace LIVE."""
        auth = _auth(app, super_admin, fresh_tenant)

        # First publish creates v1 LIVE.
        client.get(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/draft',
            headers=auth,
        )
        client.post(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/preview',
            headers=auth,
        )
        first_publish = client.post(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/publish',
            json={'note': 'v1'},
            headers=auth,
        )
        v1_id = first_publish.get_json()['data']['id']

        # Second publish — new DRAFT off LIVE, promote, publish.
        client.get(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/draft',
            headers=auth,
        )
        client.post(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/preview',
            headers=auth,
        )
        client.post(
            '/api/v1/doctor-profile-config/admin/doctor_profile/education/publish',
            json={'note': 'v2'},
            headers=auth,
        )

        # Restore v1 — pulls into a fresh DRAFT.
        restore_resp = client.post(
            f'/api/v1/doctor-profile-config/admin/doctor_profile/education/restore/{v1_id}',
            headers=auth,
        )
        assert restore_resp.status_code == 200, restore_resp.get_data(as_text=True)
        restored = restore_resp.get_json()['data']
        assert restored['status'] == 'draft', (
            'restore must land in DRAFT — not directly back to LIVE. '
            'Operator inspects, then re-publishes.'
        )
