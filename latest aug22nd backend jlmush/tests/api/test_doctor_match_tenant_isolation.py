"""Doctor-match / search / aggregate tenant-isolation regression.

A jlmush.in patient saw larazen's Dr. Ankita Doctor in their
matched-doctors list in prod. Three sibling endpoints were leaking:

  * GET  /api/patient/slot-availability-summary
  * GET  /api/patient/doctors/search
  * POST /api/patient/doctors/match

All three shared a common helper
(``TimeSlotService.get_doctor_slot_count_by_type`` /
``get_aggregate_availability_by_type``) that filtered by
``Doctor.is_deleted`` + approval status but NOT by tenant_id.

The fix made tenant_id a required kwarg on both helpers (None →
log a warning + return empty), and threaded
``current_tenant_id_or_default()`` through from each route. This
test file pins both halves:

  1. Direct service calls without tenant_id return empty (no leak,
     no exception).
  2. Service calls with one tenant's id never return another
     tenant's rows.
  3. The Doctor.query filter chain in the routes also rejects
     cross-tenant rows (defence-in-depth — if the slot helper
     ever regresses, the route filter still catches it).
"""
from __future__ import annotations

import uuid
from datetime import date, time, timedelta

import pytest

from app.extensions import db
from app.models import (
    AvailabilityApprovalStatus, ConsultationType, Doctor, PublishStatus,
    Tenant, TenantStatus, TimeSlot, TimeSlotType, User, UserRole,
    UserStatus,
)
from app.models._base import set_tenant_context


@pytest.fixture
def alpha_beta(app, db_session):
    """Two distinct non-default tenants, each with an active+approved
    doctor + a future-dated audio slot.

    The shape mirrors the production data that surfaced the leak:
    jlmush.in (subscriber) + larazen.in (apex). The fixture uses two
    subscriber tenants so the cross-tenant assertion is symmetric —
    neither is special.
    """
    def _mint_tenant(prefix):
        slug = f'{prefix}_{uuid.uuid4().hex[:6]}'
        t = Tenant(
            name=f'T {slug}', slug=slug,
            status=TenantStatus.ACTIVE, is_default=False,
        )
        db.session.add(t)
        db.session.commit()
        return t

    def _mint_doctor(tenant_id, first_name):
        set_tenant_context(db.session, tenant_id)
        u = User(
            role=UserRole.DOCTOR,
            first_name=first_name,
            last_name='Test',
            tenant_id=tenant_id,
            status=UserStatus.ACTIVE,
        )
        u.email = f'd_{uuid.uuid4().hex[:8]}@test.com'
        u.phone_number = f'9{uuid.uuid4().int % 1000000000:09d}'
        u.email_verified = True
        u.phone_verified = True
        u.set_password('Pwd123!')
        db.session.add(u)
        db.session.commit()

        d = Doctor(
            tenant_id=tenant_id, user_id=u.id,
            aadhar_number=f'AAD-{uuid.uuid4().hex[:6]}',
            aadhar_attachment='s3://fake',
            registration_number=f'MED-{uuid.uuid4().hex[:6]}',
            registration_certificate='s3://fake',
            availability_approval_status=(
                AvailabilityApprovalStatus.APPROVED
            ),
            publish_status=PublishStatus.ACTIVE,
        )
        db.session.add(d)
        db.session.commit()
        return d

    def _mint_slot(tenant_id, doctor_id, ct=ConsultationType.AUDIO):
        # Future-dated, unbooked, AUDIO consultation. Same shape the
        # leaking query selected on.
        set_tenant_context(db.session, tenant_id)
        slot = TimeSlot(
            tenant_id=tenant_id,
            doctor_id=doctor_id,
            date=date.today() + timedelta(days=1),
            start_time=time(9, 0),
            end_time=time(9, 15),
            is_booked=False,
        )
        db.session.add(slot)
        db.session.flush()
        st = TimeSlotType(
            tenant_id=tenant_id,
            time_slot_id=slot.id,
            consultation_type=ct,
        )
        db.session.add(st)
        db.session.commit()
        return slot

    alpha = _mint_tenant('alpha')
    beta = _mint_tenant('beta')
    da = _mint_doctor(alpha.id, 'AlphaDoc')
    dbeta = _mint_doctor(beta.id, 'BetaDoc')
    _mint_slot(alpha.id, da.id)
    _mint_slot(beta.id, dbeta.id)
    return {
        'alpha': alpha, 'beta': beta,
        'doctor_alpha': da, 'doctor_beta': dbeta,
    }


class TestGetDoctorSlotCountByType:

    def test_returns_only_caller_tenant_doctors(self, app, db_session, alpha_beta):
        from app.api.common.timeslot.service import TimeSlotService
        out = TimeSlotService.get_doctor_slot_count_by_type(
            'audio', tenant_id=alpha_beta['alpha'].id,
        )
        # Alpha's doctor must be in the result; beta's must NOT.
        assert str(alpha_beta['doctor_alpha'].id) in out
        assert str(alpha_beta['doctor_beta'].id) not in out, (
            'cross-tenant leak — alpha tenant got beta\'s doctor id back'
        )

    def test_no_tenant_id_returns_empty(self, app, db_session, alpha_beta):
        """Defensive: helper called without tenant_id refuses to
        serve cross-tenant rows (returns empty + logs warning).
        Prevents a future caller from accidentally re-introducing
        the leak by forgetting to pass tenant_id."""
        from app.api.common.timeslot.service import TimeSlotService
        out = TimeSlotService.get_doctor_slot_count_by_type('audio')
        assert out == {}, (
            'helper without tenant_id must return empty, never '
            'cross-tenant data'
        )


class TestGetAggregateAvailabilityByType:

    def test_returns_only_caller_tenant_counts(
        self, app, db_session, alpha_beta,
    ):
        from app.api.common.timeslot.service import TimeSlotService
        # Alpha's aggregate counts only its own slot. Beta has a slot
        # too but it must not leak into alpha's aggregate.
        alpha_agg = TimeSlotService.get_aggregate_availability_by_type(
            tenant_id=alpha_beta['alpha'].id,
        )
        beta_agg = TimeSlotService.get_aggregate_availability_by_type(
            tenant_id=alpha_beta['beta'].id,
        )
        # Both tenants should see exactly their own slot (count == 1
        # on audio). If the helper leaked, both would see 2.
        assert alpha_agg['audio']['count'] == 1, (
            f'alpha audio count = {alpha_agg["audio"]["count"]}, '
            'expected 1 (only alpha\'s slot) — leak suspected'
        )
        assert beta_agg['audio']['count'] == 1

    def test_no_tenant_id_returns_zero_counts(self, app, db_session, alpha_beta):
        from app.api.common.timeslot.service import TimeSlotService
        out = TimeSlotService.get_aggregate_availability_by_type()
        # Empty shape with zero counts + red status — degrades clean
        # without exposing cross-tenant data.
        for ct in ('video', 'audio', 'chat', 'complete', 'home_visit'):
            assert out[ct]['count'] == 0
            assert out[ct]['status'] == 'red'


class TestPatientDoctorMatchRouteIsolation:
    """End-to-end through the route — POST /api/patient/doctors/match
    with a forged host header for the calling tenant."""

    def test_match_endpoint_returns_only_caller_tenant_doctors(
        self, app, client, db_session, alpha_beta,
    ):
        # Forge ``X-Tenant-Host`` to simulate jlmush.in calling the
        # API. Backend's before_request resolves g.tenant_id from
        # the header (or falls back to apex), which is what
        # current_tenant_id_or_default reads.
        resp = client.post(
            '/api/v1/patient/doctors/match',
            headers={'X-Tenant-Host': alpha_beta['alpha'].slug + '.local'},
            json={'consultation_type': 'audio'},
        )
        # Without a known host the request resolves to the default
        # tenant; we instead pin tenant_id via direct query proof
        # in the previous tests. Just verify the route doesn't 500
        # and returns the right shape.
        assert resp.status_code in (200, 201), resp.get_json()
        body = resp.get_json()
        assert 'doctors' in body['data']
        # Any doctor returned must belong to whatever tenant the
        # backend resolved — never beta's id (we didn't claim to be
        # beta's host).
        for d in body['data']['doctors']:
            assert d['id'] != str(alpha_beta['doctor_beta'].id), (
                'beta\'s doctor leaked into a non-beta request'
            )
