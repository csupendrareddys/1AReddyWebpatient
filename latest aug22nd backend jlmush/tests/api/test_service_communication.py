"""Service Communication module — API + service tests.

Covers Phases 1–4: admin config, purchase→channel activation, persisted chat
guards, and scheduled calls with connected-duration billing.

Notes on what is / isn't covered here:
  * RLS *enforcement* is NOT asserted in pytest — the app connects as a
    Postgres superuser in tests (RLS bypassed), same as dev. It's proven
    separately with a NOSUPERUSER role probe. Here we assert the *logical*
    tenant/participant scoping (explicit filters + participant gate).
  * Rate limiting is disabled in the test config (``RATELIMIT_ENABLED=False``),
    so the 5/10s cap is verified live, not here. The flood guard (a DB check,
    not the limiter) IS covered.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.models import (
    Doctor, DoctorProduct, Patient, User, UserRole, UserVerificationStatus,
    Tenant, ServiceCommunicationConfig, MembershipVertical,
    PurchasedServiceStatus, ServiceChannelStatus, ScheduledCallStatus,
    ScheduledCallMode, ChannelEventType,
)
from app.models._base import set_tenant_context
from app.api.service_communication.service import (
    ActivationService, CallService, ConfigService, MessageService,
    ServiceCommunicationError, _connected_seconds,
)
from tests.conftest import get_auth_headers

BASE = '/api/v1/service-communication'


# ─────────────────────────────────────────────────────────────────────────
# Fixtures — a communication-enabled product + an activated channel, all
# under the default tenant so ``current_tenant_id_strict`` resolves.
# ─────────────────────────────────────────────────────────────────────────

@pytest.fixture
def tenant_id(app):
    return Tenant.query.filter_by(is_default=True).first().id


@pytest.fixture
def provider(app, db_session, tenant_id):
    """A doctor with a linked user, scoped to the default tenant."""
    set_tenant_context(db.session, tenant_id)
    user = User(
        role=UserRole.DOCTOR, first_name='Prov', last_name='Ider',
        email_verified=True, phone_verified=True, tenant_id=tenant_id,
    )
    user.email = f'prov_{uuid.uuid4().hex[:8]}@test.com'
    user.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.flush()
    # Names live on User post schema-split; Doctor carries practice fields only.
    # aadhar_number is NOT NULL in the schema, so seed a unique dummy.
    doctor = Doctor(
        user_id=user.id, tenant_id=tenant_id,
        # Unique per invocation — (tenant_id, registration_number) is a unique
        # index, and committed fixture rows can outlive a single test.
        registration_number=f'REG-{uuid.uuid4().hex[:10]}',
        registration_certificate='cert.pdf',
        aadhar_number=f'{uuid.uuid4().int % 10**12:012d}',
        aadhar_attachment='aadhar.pdf',
        verification_status=UserVerificationStatus.VERIFIED,
    )
    db.session.add(doctor)
    db.session.commit()
    return user, doctor


@pytest.fixture
def admin(app, db_session, tenant_id):
    """A super-admin — the role the config endpoints require."""
    set_tenant_context(db.session, tenant_id)
    user = User(
        role=UserRole.SUPER_ADMIN, first_name='Ad', last_name='Min',
        email_verified=True, phone_verified=True, tenant_id=tenant_id,
    )
    user.email = f'admin_{uuid.uuid4().hex[:8]}@test.com'
    user.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.commit()
    return user


@pytest.fixture
def patient(app, db_session, tenant_id):
    set_tenant_context(db.session, tenant_id)
    user = User(
        role=UserRole.PATIENT, first_name='Pat', last_name='Ient',
        email_verified=True, tenant_id=tenant_id,
    )
    user.email = f'pat_{uuid.uuid4().hex[:8]}@test.com'
    user.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.flush()
    p = Patient(user_id=user.id, tenant_id=tenant_id)
    db.session.add(p)
    db.session.commit()
    return user, p


@pytest.fixture
def product(app, db_session, tenant_id):
    set_tenant_context(db.session, tenant_id)
    p = DoctorProduct(
        tenant_id=tenant_id, name='Nutrition Package',
        min_price=1000, max_price=5000, is_active=True,
    )
    db.session.add(p)
    db.session.commit()
    return p


@pytest.fixture
def enabled_config(app, db_session, tenant_id, product):
    """Communication config with chat + both call types on."""
    set_tenant_context(db.session, tenant_id)
    cfg = ServiceCommunicationConfig(
        tenant_id=tenant_id, product_id=product.id, is_enabled=True,
        validity_days=30, chat_enabled=True, audio_enabled=True,
        video_enabled=True, documents_enabled=True, forms_enabled=True,
        audio_minutes_quota=60, video_minutes_quota=60,
        max_attachment_mb=5, retention_days=365,
    )
    db.session.add(cfg)
    db.session.commit()
    return cfg


@pytest.fixture
def channel(app, db_session, tenant_id, product, enabled_config, patient, provider):
    """An activated channel between patient and provider."""
    _, pat = patient
    _, doc = provider
    purchase, ch, created = ActivationService.activate(
        product_id=product.id, patient_id=pat.id,
        provider_type='doctor', provider_id=doc.id, tenant_id=tenant_id,
    )
    assert created
    return purchase, ch


@pytest.fixture
def provider2(app, db_session, tenant_id):
    """A second doctor with a linked user — a group co-doctor."""
    set_tenant_context(db.session, tenant_id)
    user = User(
        role=UserRole.DOCTOR, first_name='Cody', last_name='Octor',
        email_verified=True, phone_verified=True, tenant_id=tenant_id,
    )
    user.email = f'prov2_{uuid.uuid4().hex[:8]}@test.com'
    user.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.flush()
    doctor = Doctor(
        user_id=user.id, tenant_id=tenant_id,
        registration_number=f'REG-{uuid.uuid4().hex[:10]}',
        registration_certificate='cert.pdf',
        aadhar_number=f'{uuid.uuid4().int % 10**12:012d}',
        aadhar_attachment='aadhar.pdf',
        verification_status=UserVerificationStatus.VERIFIED,
    )
    db.session.add(doctor)
    db.session.commit()
    return user, doctor


@pytest.fixture
def service_group(app, db_session, tenant_id, product, enabled_config,
                  provider, provider2):
    """An approved group offering: lead + one co-doctor, both accepted."""
    from app.models import (
        MarketplaceServiceGroup, MarketplaceServiceGroupMember,
    )
    set_tenant_context(db.session, tenant_id)
    _, lead = provider
    _, member = provider2
    group = MarketplaceServiceGroup(
        tenant_id=tenant_id, product_id=product.id,
        created_by_doctor_id=lead.id, group_price=4000,
        group_description='Care team package', approval_status='approved',
        is_active=True,
    )
    db.session.add(group)
    db.session.flush()
    db.session.add_all([
        MarketplaceServiceGroupMember(
            tenant_id=tenant_id, group_id=group.id, doctor_id=lead.id,
            role='lead', status='accepted',
        ),
        MarketplaceServiceGroupMember(
            tenant_id=tenant_id, group_id=group.id, doctor_id=member.id,
            role='member', status='accepted',
        ),
    ])
    db.session.commit()
    return group


# ─────────────────────────────────────────────────────────────────────────
# Config validation (Phase 1)
# ─────────────────────────────────────────────────────────────────────────

class TestConfigValidation:
    def test_rejects_zero_validity(self):
        errs = ConfigService.validate({'validity_days': 0})
        assert any('validity_days' in e for e in errs)

    def test_rejects_negative_quota(self):
        errs = ConfigService.validate({'audio_minutes_quota': -5})
        assert any('audio_minutes_quota' in e for e in errs)

    def test_rejects_non_bool_toggle(self):
        errs = ConfigService.validate({'chat_enabled': 'yes'})
        assert any('chat_enabled' in e for e in errs)

    def test_accepts_null_quota_as_unlimited(self):
        assert ConfigService.validate({'audio_minutes_quota': None}) == []

    def test_valid_payload_passes(self):
        assert ConfigService.validate({
            'is_enabled': True, 'validity_days': 84, 'chat_enabled': True,
            'audio_minutes_quota': 120, 'video_minutes_quota': None,
        }) == []

    def test_get_config_returns_null_when_absent(self, app, client, admin, product):
        r = client.get(f'{BASE}/config/{product.id}',
                       headers=get_auth_headers(app, admin))
        assert r.status_code == 200
        assert r.get_json()['data']['config'] is None


# ─────────────────────────────────────────────────────────────────────────
# Activation (Phase 2)
# ─────────────────────────────────────────────────────────────────────────

class TestActivation:
    def test_refuses_when_not_enabled(self, app, tenant_id, product, patient, provider):
        _, pat = patient
        _, doc = provider
        with pytest.raises(ServiceCommunicationError) as exc:
            ActivationService.activate(
                product_id=product.id, patient_id=pat.id,
                provider_type='doctor', provider_id=doc.id, tenant_id=tenant_id,
            )
        assert exc.value.status_code == 400

    def test_creates_channel_with_two_participants(self, channel):
        purchase, ch = channel
        assert ch.status == ServiceChannelStatus.ACTIVE
        assert purchase.status == PurchasedServiceStatus.ACTIVE
        roles = sorted(p.role.value for p in ch.participants if not p.is_deleted)
        assert roles == ['patient', 'provider']

    def test_snapshots_config_onto_purchase(self, channel, enabled_config):
        purchase, _ = channel
        # Later edits to the config must not change what was already sold.
        enabled_config.video_minutes_quota = 5
        db.session.commit()
        assert purchase.video_minutes_quota == 60  # snapshot, not live

    def test_computes_validity_window(self, channel):
        purchase, _ = channel
        span = (purchase.valid_until - purchase.valid_from).days
        assert span == 30

    def test_idempotent(self, app, tenant_id, product, enabled_config, patient, provider):
        _, pat = patient
        _, doc = provider
        kw = dict(product_id=product.id, patient_id=pat.id,
                  provider_type='doctor', provider_id=doc.id, tenant_id=tenant_id)
        _p1, c1, created1 = ActivationService.activate(**kw)
        _p2, c2, created2 = ActivationService.activate(**kw)
        assert created1 and not created2
        assert c1.id == c2.id

    def test_records_timeline_events(self, channel):
        _, ch = channel
        from app.models import ChannelEvent
        types = {e.event_type for e in
                 ChannelEvent.query.filter_by(channel_id=ch.id).all()}
        assert ChannelEventType.SERVICE_BOOKED in types
        assert ChannelEventType.CHANNEL_CREATED in types

    def test_invalid_provider_type(self, app, tenant_id, product, enabled_config, patient):
        _, pat = patient
        with pytest.raises(ServiceCommunicationError):
            ActivationService.activate(
                product_id=product.id, patient_id=pat.id,
                provider_type='wizard', provider_id=uuid.uuid4(),
                tenant_id=tenant_id,
            )


# ─────────────────────────────────────────────────────────────────────────
# Chat (Phase 3)
# ─────────────────────────────────────────────────────────────────────────

class TestChat:
    def _hdr(self, app, user):
        return get_auth_headers(app, user)

    def test_participant_can_send(self, app, client, channel, patient):
        _, ch = channel
        user, _ = patient
        r = client.post(f'{BASE}/channels/{ch.id}/messages',
                        headers=self._hdr(app, user), json={'body': 'Hello'})
        assert r.status_code == 201
        assert r.get_json()['data']['body'] == 'Hello'

    def test_empty_body_rejected(self, app, client, channel, patient):
        _, ch = channel
        user, _ = patient
        r = client.post(f'{BASE}/channels/{ch.id}/messages',
                        headers=self._hdr(app, user), json={'body': '   '})
        assert r.status_code == 400

    def test_idempotent_send(self, app, client, channel, patient):
        _, ch = channel
        user, _ = patient
        h = self._hdr(app, user)
        cid = 'cmid-1'
        r1 = client.post(f'{BASE}/channels/{ch.id}/messages', headers=h,
                         json={'body': 'once', 'client_msg_id': cid})
        r2 = client.post(f'{BASE}/channels/{ch.id}/messages', headers=h,
                         json={'body': 'once', 'client_msg_id': cid})
        assert r1.status_code == 201 and r2.status_code == 200
        assert r1.get_json()['data']['id'] == r2.get_json()['data']['id']

    def test_flood_guard_blocks_duplicate(self, app, client, channel, provider):
        _, ch = channel
        user, _ = provider
        h = self._hdr(app, user)
        client.post(f'{BASE}/channels/{ch.id}/messages', headers=h, json={'body': 'dup'})
        r = client.post(f'{BASE}/channels/{ch.id}/messages', headers=h, json={'body': 'dup'})
        assert r.status_code == 429

    def test_non_participant_gets_404(self, app, client, channel, tenant_id):
        _, ch = channel
        # A brand-new doctor who isn't in this channel.
        set_tenant_context(db.session, tenant_id)
        u = User(role=UserRole.DOCTOR, first_name='X', last_name='Y',
                 email_verified=True, phone_verified=True, tenant_id=tenant_id)
        u.email = f'other_{uuid.uuid4().hex[:8]}@test.com'
        u.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
        u.set_password('TestPass123!')
        db.session.add(u)
        db.session.commit()
        r = client.post(f'{BASE}/channels/{ch.id}/messages',
                        headers=self._hdr(app, u), json={'body': 'let me in'})
        assert r.status_code == 404

    def test_history_oldest_first(self, app, client, channel, patient, provider):
        _, ch = channel
        pu, _ = patient
        du, _ = provider
        client.post(f'{BASE}/channels/{ch.id}/messages',
                    headers=self._hdr(app, pu), json={'body': 'first'})
        client.post(f'{BASE}/channels/{ch.id}/messages',
                    headers=self._hdr(app, du), json={'body': 'second'})
        r = client.get(f'{BASE}/channels/{ch.id}/messages',
                       headers=self._hdr(app, pu))
        bodies = [m['body'] for m in r.get_json()['data']['messages']]
        assert bodies == ['first', 'second']

    def test_send_blocked_after_expiry_history_readable(self, app, client, channel, patient):
        purchase, ch = channel
        user, _ = patient
        h = self._hdr(app, user)
        client.post(f'{BASE}/channels/{ch.id}/messages', headers=h, json={'body': 'before'})
        # Expire it.
        purchase.valid_until = datetime.now(timezone.utc) - timedelta(hours=1)
        db.session.commit()
        r_send = client.post(f'{BASE}/channels/{ch.id}/messages', headers=h,
                             json={'body': 'after'})
        assert r_send.status_code == 403
        r_hist = client.get(f'{BASE}/channels/{ch.id}/messages', headers=h)
        assert r_hist.status_code == 200
        assert len(r_hist.get_json()['data']['messages']) >= 1

    def test_send_blocked_when_chat_disabled(self, app, client, tenant_id,
                                             product, patient, provider):
        # A config with chat OFF (but the service otherwise enabled).
        set_tenant_context(db.session, tenant_id)
        cfg = ServiceCommunicationConfig(
            tenant_id=tenant_id, product_id=product.id, is_enabled=True,
            validity_days=30, chat_enabled=False, audio_enabled=True,
            video_enabled=False,
        )
        db.session.add(cfg)
        db.session.commit()
        _, pat = patient
        _, doc = provider
        _purchase, ch, _ = ActivationService.activate(
            product_id=product.id, patient_id=pat.id, provider_type='doctor',
            provider_id=doc.id, tenant_id=tenant_id,
        )
        user, _ = patient
        r = client.post(f'{BASE}/channels/{ch.id}/messages',
                        headers=self._hdr(app, user), json={'body': 'hi'})
        assert r.status_code == 403


# ─────────────────────────────────────────────────────────────────────────
# Scheduled calls + connected-duration billing (Phase 4)
# ─────────────────────────────────────────────────────────────────────────

class TestConnectedSeconds:
    """The pure billing function — the headline requirement."""

    def test_canonical_example_13_minutes(self):
        base = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)

        class S:
            def __init__(s, j, l):
                s.joined_at, s.left_at = j, l
        prov = S(base + timedelta(minutes=2), None)   # 10:02
        pat = S(base + timedelta(minutes=7), None)    # 10:07
        end = base + timedelta(minutes=20)            # 10:20
        assert _connected_seconds([prov, pat], end) == 13 * 60

    def test_disjoint_sessions_zero(self):
        base = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)

        class S:
            def __init__(s, j, l):
                s.joined_at, s.left_at = j, l
        a = S(base, base + timedelta(minutes=5))
        b = S(base + timedelta(minutes=6), base + timedelta(minutes=10))
        assert _connected_seconds([a, b], None) == 0

    def test_single_participant_zero(self):
        base = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)

        class S:
            def __init__(s, j, l):
                s.joined_at, s.left_at = j, l
        assert _connected_seconds([S(base, base + timedelta(minutes=30))], None) == 0


class TestScheduledCalls:
    def _hdr(self, app, user):
        return get_auth_headers(app, user)

    def test_patient_cannot_schedule(self, app, client, channel, patient):
        _, ch = channel
        user, _ = patient
        r = client.post(f'{BASE}/channels/{ch.id}/calls', headers=self._hdr(app, user),
                        json={'mode': 'video',
                              'scheduled_start': '2026-08-01T10:00:00+00:00',
                              'scheduled_end': '2026-08-01T10:30:00+00:00'})
        assert r.status_code == 403

    def test_provider_schedules(self, app, client, channel, provider):
        _, ch = channel
        user, _ = provider
        r = client.post(f'{BASE}/channels/{ch.id}/calls', headers=self._hdr(app, user),
                        json={'mode': 'video',
                              'scheduled_start': '2026-08-01T10:00:00+00:00',
                              'scheduled_end': '2026-08-01T10:30:00+00:00'})
        assert r.status_code == 201
        assert r.get_json()['data']['status'] == 'scheduled'

    def test_schedule_rejected_for_disabled_mode(self, app, client, tenant_id,
                                                 product, patient, provider):
        set_tenant_context(db.session, tenant_id)
        cfg = ServiceCommunicationConfig(
            tenant_id=tenant_id, product_id=product.id, is_enabled=True,
            validity_days=30, chat_enabled=True, audio_enabled=False,
            video_enabled=False,
        )
        db.session.add(cfg)
        db.session.commit()
        _, pat = patient
        _, doc = provider
        _purchase, ch, _ = ActivationService.activate(
            product_id=product.id, patient_id=pat.id, provider_type='doctor',
            provider_id=doc.id, tenant_id=tenant_id,
        )
        user, _ = provider
        r = client.post(f'{BASE}/channels/{ch.id}/calls', headers=self._hdr(app, user),
                        json={'mode': 'video',
                              'scheduled_start': '2026-08-01T10:00:00+00:00',
                              'scheduled_end': '2026-08-01T10:30:00+00:00'})
        assert r.status_code == 403

    def test_end_to_end_duration_decrements_quota(self, app, client, channel,
                                                  provider, patient, tenant_id):
        """Join both, backdate the sessions, end → quota reflects real minutes."""
        from app.models import CallSession, ScheduledCall, PurchasedService
        purchase, ch = channel
        du, _ = provider
        pu, _ = patient
        h_doc = self._hdr(app, du)

        # Schedule + both join.
        r = client.post(f'{BASE}/channels/{ch.id}/calls', headers=h_doc,
                        json={'mode': 'video',
                              'scheduled_start': '2026-08-01T10:00:00+00:00',
                              'scheduled_end': '2026-08-01T10:30:00+00:00'})
        call_id = r.get_json()['data']['id']
        client.post(f'{BASE}/channels/{ch.id}/calls/{call_id}/join', headers=h_doc)
        client.post(f'{BASE}/channels/{ch.id}/calls/{call_id}/join',
                    headers=self._hdr(app, pu))

        # Backdate the open sessions to the canonical timeline.
        now = datetime.now(timezone.utc)
        sessions = CallSession.query.filter_by(scheduled_call_id=call_id).all()
        assert len(sessions) == 2
        # Provider on 18m, patient 13m → overlap 13m.
        for s in sessions:
            part_role = None
            for p in ch.participants:
                if p.id == s.participant_id:
                    part_role = p.role.value
            s.joined_at = now - timedelta(minutes=18 if part_role == 'provider' else 13)
        db.session.commit()

        before = purchase.video_minutes_used
        client.post(f'{BASE}/channels/{ch.id}/calls/{call_id}/end', headers=h_doc)

        db.session.refresh(purchase)
        call = ScheduledCall.query.get(call_id)
        assert call.status == ScheduledCallStatus.COMPLETED
        assert call.connected_seconds == 13 * 60
        assert purchase.video_minutes_used - before == 13

    def test_join_blocked_when_quota_exhausted(self, app, client, channel, provider):
        purchase, ch = channel
        user, _ = provider
        h = self._hdr(app, user)
        # Exhaust the video quota.
        purchase.video_minutes_quota = 10
        purchase.video_minutes_used = 10
        db.session.commit()
        r = client.post(f'{BASE}/channels/{ch.id}/calls', headers=h,
                        json={'mode': 'video',
                              'scheduled_start': '2026-08-01T10:00:00+00:00',
                              'scheduled_end': '2026-08-01T10:30:00+00:00'})
        assert r.status_code == 403

    def test_patient_accepts(self, app, client, channel, provider, patient):
        _, ch = channel
        du, _ = provider
        pu, _ = patient
        r = client.post(f'{BASE}/channels/{ch.id}/calls', headers=self._hdr(app, du),
                        json={'mode': 'audio',
                              'scheduled_start': '2026-08-01T10:00:00+00:00',
                              'scheduled_end': '2026-08-01T10:30:00+00:00'})
        call_id = r.get_json()['data']['id']
        r2 = client.post(f'{BASE}/channels/{ch.id}/calls/{call_id}/accept',
                         headers=self._hdr(app, pu))
        assert r2.status_code == 200
        assert r2.get_json()['data']['status'] == 'accepted'


# ─────────────────────────────────────────────────────────────────────────
# Regression tests for the 5 defects found by adversarial review
# ─────────────────────────────────────────────────────────────────────────

class TestReviewRegressions:
    def _hdr(self, app, user):
        return get_auth_headers(app, user)

    def test_duplicate_open_session_billing_not_inflated(self):
        """#1: one participant with two overlapping sessions counts as ONE
        present party, so a solo call bills 0 (not the whole window)."""
        base = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)

        class S:
            def __init__(s, pid, j, l):
                s.participant_id, s.joined_at, s.left_at = pid, j, l
        # Same participant, two overlapping sessions; nobody else on the call.
        p = uuid.uuid4()
        s1 = S(p, base, base + timedelta(minutes=10))
        s2 = S(p, base + timedelta(minutes=1), base + timedelta(minutes=10))
        assert _connected_seconds([s1, s2], None) == 0

    def test_open_session_unique_index_blocks_second_open(self, app, channel, provider):
        """#1 (DB guard): a second OPEN CallSession for the same participant on
        the same call violates the partial-unique index."""
        from app.models import CallSession, ScheduledCall, ScheduledCallMode
        from sqlalchemy.exc import IntegrityError
        purchase, ch = channel
        provider_part = next(p for p in ch.participants if p.role.value == 'provider')
        call = ScheduledCall(
            tenant_id=ch.tenant_id, channel_id=ch.id, mode=ScheduledCallMode.AUDIO,
            scheduled_start=datetime.now(timezone.utc),
            scheduled_end=datetime.now(timezone.utc) + timedelta(minutes=30),
        )
        db.session.add(call)
        db.session.flush()
        db.session.add(CallSession(tenant_id=ch.tenant_id, scheduled_call_id=call.id,
                                   participant_id=provider_part.id))
        db.session.flush()
        db.session.add(CallSession(tenant_id=ch.tenant_id, scheduled_call_id=call.id,
                                   participant_id=provider_part.id))
        with pytest.raises(IntegrityError):
            db.session.flush()
        db.session.rollback()

    def test_cancel_in_progress_refused(self, app, client, channel, provider, patient):
        """#4: an IN_PROGRESS call cannot be cancelled (would drop minutes)."""
        _, ch = channel
        du, _ = provider
        pu, _ = patient
        r = client.post(f'{BASE}/channels/{ch.id}/calls', headers=self._hdr(app, du),
                        json={'mode': 'audio',
                              'scheduled_start': '2026-08-01T10:00:00+00:00',
                              'scheduled_end': '2026-08-01T10:30:00+00:00'})
        call_id = r.get_json()['data']['id']
        client.post(f'{BASE}/channels/{ch.id}/calls/{call_id}/join',
                    headers=self._hdr(app, du))
        rc = client.post(f'{BASE}/channels/{ch.id}/calls/{call_id}/cancel',
                         headers=self._hdr(app, pu))
        assert rc.status_code == 409

    def test_propose_blocked_when_calls_disabled(self, app, client, tenant_id,
                                                 product, patient, provider):
        """#3: propose() can't inject a message on a chat-only service."""
        set_tenant_context(db.session, tenant_id)
        cfg = ServiceCommunicationConfig(
            tenant_id=tenant_id, product_id=product.id, is_enabled=True,
            validity_days=30, chat_enabled=True, audio_enabled=False,
            video_enabled=False,
        )
        db.session.add(cfg)
        db.session.commit()
        _, pat = patient
        _, doc = provider
        _purchase, ch, _ = ActivationService.activate(
            product_id=product.id, patient_id=pat.id, provider_type='doctor',
            provider_id=doc.id, tenant_id=tenant_id,
        )
        user, _ = patient
        r = client.post(f'{BASE}/channels/{ch.id}/calls/propose',
                        headers=self._hdr(app, user),
                        json={'suggested_time': 'tomorrow 3pm'})
        assert r.status_code == 403

    def test_active_purchase_unique_index(self, app, tenant_id, product,
                                          enabled_config, patient, provider):
        """#5: a second ACTIVE PurchasedService for the same tuple violates
        the partial-unique index (the DB guard behind activation idempotency)."""
        from app.models import PurchasedService
        from sqlalchemy.exc import IntegrityError
        _, pat = patient
        _, doc = provider
        # First activation makes one active purchase.
        ActivationService.activate(
            product_id=product.id, patient_id=pat.id, provider_type='doctor',
            provider_id=doc.id, tenant_id=tenant_id,
        )
        # A raw second active row for the same tuple must be rejected.
        dup = PurchasedService(
            tenant_id=tenant_id, product_id=product.id, patient_id=pat.id,
            provider_type=MembershipVertical.DOCTOR, provider_id=doc.id,
            status=PurchasedServiceStatus.ACTIVE,
            valid_from=datetime.now(timezone.utc),
            valid_until=datetime.now(timezone.utc) + timedelta(days=30),
        )
        db.session.add(dup)
        with pytest.raises(IntegrityError):
            db.session.flush()
        db.session.rollback()


# ─────────────────────────────────────────────────────────────────────────
# Documents, forms, timeline (Phases 5–6)
# ─────────────────────────────────────────────────────────────────────────

class TestFormsTimeline:
    def _hdr(self, app, user):
        return get_auth_headers(app, user)

    def test_submit_and_list_form(self, app, client, channel, patient, provider):
        _, ch = channel
        pu, _ = patient
        du, _ = provider
        r = client.post(f'{BASE}/channels/{ch.id}/forms', headers=self._hdr(app, pu),
                        json={'form_key': 'intake_v1',
                              'answers': {'weight_kg': 72}})
        assert r.status_code == 201
        r2 = client.get(f'{BASE}/channels/{ch.id}/forms', headers=self._hdr(app, du))
        forms = r2.get_json()['data']['forms']
        assert len(forms) == 1 and forms[0]['answers'] == {'weight_kg': 72}

    def test_form_blocked_when_disabled(self, app, client, tenant_id, product,
                                        patient, provider):
        set_tenant_context(db.session, tenant_id)
        cfg = ServiceCommunicationConfig(
            tenant_id=tenant_id, product_id=product.id, is_enabled=True,
            validity_days=30, chat_enabled=True, forms_enabled=False,
        )
        db.session.add(cfg)
        db.session.commit()
        _, pat = patient
        _, doc = provider
        _p, ch, _ = ActivationService.activate(
            product_id=product.id, patient_id=pat.id, provider_type='doctor',
            provider_id=doc.id, tenant_id=tenant_id,
        )
        user, _ = patient
        r = client.post(f'{BASE}/channels/{ch.id}/forms', headers=self._hdr(app, user),
                        json={'form_key': 'x', 'answers': {}})
        assert r.status_code == 403

    def test_timeline_returns_events(self, app, client, channel, patient):
        _, ch = channel
        user, _ = patient
        r = client.get(f'{BASE}/channels/{ch.id}/timeline', headers=self._hdr(app, user))
        assert r.status_code == 200
        types = [e['event_type'] for e in r.get_json()['data']['events']]
        assert 'service_booked' in types and 'channel_created' in types

    def test_document_list_non_participant_404(self, app, client, channel, tenant_id):
        _, ch = channel
        set_tenant_context(db.session, tenant_id)
        u = User(role=UserRole.PATIENT, first_name='N', last_name='P',
                 email_verified=True, tenant_id=tenant_id)
        u.email = f'np_{uuid.uuid4().hex[:8]}@test.com'
        u.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
        u.set_password('TestPass123!')
        db.session.add(u)
        db.session.commit()
        r = client.get(f'{BASE}/channels/{ch.id}/documents', headers=self._hdr(app, u))
        assert r.status_code == 404

    def test_upload_blocked_when_documents_disabled(self, app, tenant_id, product,
                                                    patient, provider):
        from app.api.service_communication.service import DocumentService
        set_tenant_context(db.session, tenant_id)
        cfg = ServiceCommunicationConfig(
            tenant_id=tenant_id, product_id=product.id, is_enabled=True,
            validity_days=30, chat_enabled=True, documents_enabled=False,
        )
        db.session.add(cfg)
        db.session.commit()
        _, pat = patient
        _, doc = provider
        _p, ch, _ = ActivationService.activate(
            product_id=product.id, patient_id=pat.id, provider_type='doctor',
            provider_id=doc.id, tenant_id=tenant_id,
        )
        # documents_enabled gate fires before any S3 call.
        with pytest.raises(ServiceCommunicationError) as exc:
            DocumentService.upload(ch.id, pat.user_id, tenant_id, file_obj=None)
        assert exc.value.status_code == 403


class TestRetention:
    def test_purge_deletes_messages_and_archives(self, app, db_session, tenant_id,
                                                 channel, patient):
        """A channel read-only past its retention window is purged + archived,
        and its audit events survive."""
        from app.models import (
            ChannelMessage, ChannelMessageKind, ServiceChannelStatus,
            ServiceChannel, PurchasedService, ChannelEvent, ChannelEventType,
        )
        from app.api.service_communication.retention_job import _purge_retention
        purchase, ch = channel
        pu, _ = patient
        part = next(p for p in ch.participants if p.role.value == 'patient')

        # Seed a message.
        db.session.add(ChannelMessage(
            tenant_id=tenant_id, channel_id=ch.id, sender_participant_id=part.id,
            kind=ChannelMessageKind.TEXT, body='keep-until-retention',
        ))
        # Put the channel read-only, retention 30d, read_only 40d ago.
        purchase.retention_days = 30
        ch.status = ServiceChannelStatus.READ_ONLY
        ch.read_only_at = datetime.now(timezone.utc) - timedelta(days=40)
        db.session.commit()

        _purge_retention()

        db.session.refresh(ch)
        assert ch.status == ServiceChannelStatus.ARCHIVED
        assert ch.archived_at is not None
        assert ChannelMessage.query.filter_by(channel_id=ch.id).count() == 0
        # The audit trail is preserved, incl. the archival event.
        ev = {e.event_type for e in ChannelEvent.query.filter_by(channel_id=ch.id).all()}
        assert ChannelEventType.CONVERSATION_ARCHIVED in ev
        assert ChannelEventType.SERVICE_BOOKED in ev  # not purged

    def test_purge_skips_channel_within_retention(self, app, db_session, tenant_id,
                                                  channel):
        from app.models import ServiceChannel, ServiceChannelStatus, PurchasedService
        from app.api.service_communication.retention_job import _purge_retention
        purchase, ch = channel
        purchase.retention_days = 365
        ch.status = ServiceChannelStatus.READ_ONLY
        ch.read_only_at = datetime.now(timezone.utc) - timedelta(days=5)  # within
        db.session.commit()
        _purge_retention()
        db.session.refresh(ch)
        assert ch.status == ServiceChannelStatus.READ_ONLY  # untouched


class TestGroupActivation:
    def _hdr(self, app, user):
        return get_auth_headers(app, user)

    def test_creates_group_chat_and_per_doctor_channels(
        self, app, db_session, tenant_id, service_group, patient,
    ):
        from app.models import PurchasedService, ServiceChannelKind
        _, pat = patient
        member_channels, group_channel, _group = ActivationService.activate_group(
            group_id=service_group.id, patient_id=pat.id, tenant_id=tenant_id,
        )
        # One 1:1 leg per doctor + one group channel.
        assert len(member_channels) == 2
        assert group_channel is not None
        assert group_channel.kind == ServiceChannelKind.GROUP

        # Group channel roster = patient + both doctors.
        gparts = [p for p in group_channel.participants if not p.is_deleted]
        assert sorted(p.role.value for p in gparts) == [
            'patient', 'provider', 'provider']

        # Each per-doctor leg is a 2-person single channel.
        for _pur, ch in member_channels:
            assert ch.kind == ServiceChannelKind.SINGLE
            assert len([p for p in ch.participants if not p.is_deleted]) == 2

        # Entitlements: 2 per-doctor + 1 shared, all active.
        rows = PurchasedService.query.filter_by(
            tenant_id=tenant_id, service_group_id=service_group.id,
            status=PurchasedServiceStatus.ACTIVE, is_deleted=False,
        ).all()
        assert sorted(r.kind.value for r in rows) == [
            'group_per_doctor', 'group_per_doctor', 'group_shared']

    def test_idempotent(self, app, db_session, tenant_id, service_group, patient):
        from app.models import PurchasedService
        _, pat = patient
        mc1, gc1, _ = ActivationService.activate_group(
            group_id=service_group.id, patient_id=pat.id, tenant_id=tenant_id)
        mc2, gc2, _ = ActivationService.activate_group(
            group_id=service_group.id, patient_id=pat.id, tenant_id=tenant_id)
        assert gc1.id == gc2.id
        assert {c.id for _, c in mc1} == {c.id for _, c in mc2}
        # No duplicate entitlements minted on the second run.
        assert PurchasedService.query.filter_by(
            tenant_id=tenant_id, service_group_id=service_group.id,
            status=PurchasedServiceStatus.ACTIVE, is_deleted=False,
        ).count() == 3

    def test_lead_holds_both_leg_and_shared_without_collision(
        self, app, db_session, tenant_id, service_group, patient, provider,
    ):
        """The lead is both a per-doctor leg and the shared row's nominal owner
        — same provider_id, two live rows — which the split unique index allows."""
        from app.models import PurchasedService
        _, pat = patient
        _, lead = provider
        ActivationService.activate_group(
            group_id=service_group.id, patient_id=pat.id, tenant_id=tenant_id)
        lead_rows = PurchasedService.query.filter_by(
            tenant_id=tenant_id, service_group_id=service_group.id,
            provider_id=lead.id, status=PurchasedServiceStatus.ACTIVE,
            is_deleted=False,
        ).all()
        assert sorted(r.kind.value for r in lead_rows) == [
            'group_per_doctor', 'group_shared']

    def test_individual_purchase_still_works_alongside_group(
        self, app, db_session, tenant_id, service_group, product, patient, provider,
    ):
        """A group leg for (product, patient, lead) must not block a separate
        INDIVIDUAL purchase of the same product from the same doctor."""
        _, pat = patient
        _, lead = provider
        ActivationService.activate_group(
            group_id=service_group.id, patient_id=pat.id, tenant_id=tenant_id)
        purchase, ch, created = ActivationService.activate(
            product_id=product.id, patient_id=pat.id,
            provider_type='doctor', provider_id=lead.id, tenant_id=tenant_id,
        )
        assert created and ch is not None
        assert purchase.service_group_id is None

    def test_refuses_when_config_disabled(
        self, app, db_session, tenant_id, provider, patient,
    ):
        from app.models import (
            DoctorProduct, MarketplaceServiceGroup, MarketplaceServiceGroupMember,
        )
        set_tenant_context(db.session, tenant_id)
        _, lead = provider
        _, pat = patient
        prod = DoctorProduct(tenant_id=tenant_id, name='No-Comms Group',
                             min_price=1000, max_price=5000, is_active=True)
        db.session.add(prod)
        db.session.flush()
        grp = MarketplaceServiceGroup(
            tenant_id=tenant_id, product_id=prod.id, created_by_doctor_id=lead.id,
            group_price=2000, approval_status='approved', is_active=True)
        db.session.add(grp)
        db.session.flush()
        db.session.add(MarketplaceServiceGroupMember(
            tenant_id=tenant_id, group_id=grp.id, doctor_id=lead.id,
            role='lead', status='accepted'))
        db.session.commit()
        with pytest.raises(ServiceCommunicationError) as exc:
            ActivationService.activate_group(
                group_id=grp.id, patient_id=pat.id, tenant_id=tenant_id)
        assert exc.value.status_code == 400

    def test_unapproved_group_refused(
        self, app, db_session, tenant_id, service_group, patient,
    ):
        _, pat = patient
        service_group.approval_status = 'pending'
        db.session.commit()
        with pytest.raises(ServiceCommunicationError) as exc:
            ActivationService.activate_group(
                group_id=service_group.id, patient_id=pat.id, tenant_id=tenant_id)
        assert exc.value.status_code == 404

    def test_route_activates_group_for_admin(
        self, app, client, db_session, tenant_id, service_group, patient, admin,
    ):
        """The admin HTTP surface mints the group chat + per-doctor legs and
        serialises them in the ``{group_channel, member_channels}`` shape."""
        _, pat = patient
        r = client.post(
            f'{BASE}/group-purchases',
            json={'group_id': str(service_group.id), 'patient_id': str(pat.id)},
            headers=self._hdr(app, admin),
        )
        assert r.status_code == 201
        data = r.get_json()['data']
        assert data['service_group_id'] == str(service_group.id)
        assert data['group_channel']['channel']['kind'] == 'group'
        assert len(data['member_channels']) == 2
        assert all(mc['channel']['kind'] == 'single'
                   for mc in data['member_channels'])

    def test_route_requires_group_and_patient(self, app, client, admin):
        r = client.post(f'{BASE}/group-purchases', json={},
                        headers=self._hdr(app, admin))
        assert r.status_code == 400

    def test_any_group_doctor_can_post_and_patient_reads(
        self, app, client, db_session, tenant_id, service_group, patient, provider2,
    ):
        _, pat = patient
        pu, _ = patient
        p2u, _ = provider2
        _mc, gc, _ = ActivationService.activate_group(
            group_id=service_group.id, patient_id=pat.id, tenant_id=tenant_id)
        # The co-doctor (not the lead) posts into the group channel.
        r = client.post(f'{BASE}/channels/{gc.id}/messages',
                        json={'body': 'Hello team'}, headers=self._hdr(app, p2u))
        assert r.status_code == 201
        # The patient — a participant of the same group channel — can read it.
        r2 = client.get(f'{BASE}/channels/{gc.id}/messages',
                        headers=self._hdr(app, pu))
        assert r2.status_code == 200
        bodies = [m['body'] for m in r2.get_json()['data']['messages']]
        assert 'Hello team' in bodies


class TestMarketplacePayment:
    """Payment for service / group-service orders → order paid + channel opens.

    The Razorpay create-order call hits Razorpay's live API, so these tests
    drive the /verify path directly with a locally-computed HMAC signature
    (we own RAZORPAY_KEY_SECRET here) — that's where the custom logic lives:
    confirm → mark order paid → activate the channel(s).
    """
    SECRET = 'test_razorpay_secret'

    def _hdr(self, app, user):
        return get_auth_headers(app, user)

    def _sig(self, rz_order, rz_payment):
        import hmac, hashlib
        return hmac.new(self.SECRET.encode(), f'{rz_order}|{rz_payment}'.encode(),
                        hashlib.sha256).hexdigest()

    def _make_order(self, tenant_id, patient, doctor, product, *, status='pending',
                    group_id=None, price=1200):
        from app.models import MarketplaceOrder
        order = MarketplaceOrder(
            tenant_id=tenant_id, patient_id=patient.id, doctor_id=doctor.id,
            product_id=product.id, group_id=group_id,
            price_at_purchase=price, status=status,
        )
        db.session.add(order)
        db.session.commit()
        return order

    def _make_payment(self, tenant_id, order, user, rz_order=None):
        from app.models import Payment, PaymentStatus
        # Unique gateway id per payment — activate() commits mid-request, so a
        # paid payment row survives the per-test rollback; unique ids keep a
        # re-run on a reused test DB from colliding on the transaction_id index.
        rz_order = rz_order or f'rzo_{uuid.uuid4().hex}'
        pay = Payment(
            tenant_id=tenant_id, order_id=order.id, user_id=user.id,
            amount=order.price_at_purchase, currency='INR',
            payment_gateway='razorpay', gateway_order_id=rz_order,
            status=PaymentStatus.CREATED,
        )
        db.session.add(pay)
        db.session.commit()
        return pay

    def _verify(self, app, client, user, pay, rz_payment=None):
        rz_order = pay.gateway_order_id
        rz_payment = rz_payment or f'rzp_{uuid.uuid4().hex}'
        return client.post('/api/v1/payment/verify', headers=self._hdr(app, user), json={
            'razorpay_order_id': rz_order,
            'razorpay_payment_id': rz_payment,
            'razorpay_signature': self._sig(rz_order, rz_payment),
            'payment_id': str(pay.id),
        })

    def test_paying_order_marks_paid_no_channel_yet(
        self, app, client, monkeypatch, db_session, tenant_id, product,
        enabled_config, patient, provider,
    ):
        # Patient pays at booking → order 'paid', awaiting the provider's
        # accept/reject. The channel opens only on accept, not on payment.
        monkeypatch.setenv('RAZORPAY_KEY_SECRET', self.SECRET)
        pu, pat = patient
        _, doc = provider
        order = self._make_order(tenant_id, pat, doc, product)
        pay = self._make_payment(tenant_id, order, pu)
        r = self._verify(app, client, pu, pay)
        assert r.status_code == 200
        assert r.get_json()['data']['order_id'] == str(order.id)

        from app.models import PurchasedService
        db.session.refresh(order)
        assert order.status == 'paid'
        assert PurchasedService.query.filter_by(
            tenant_id=tenant_id, order_id=order.id).first() is None

    def test_accept_after_payment_opens_channel(
        self, app, client, monkeypatch, db_session, tenant_id, product,
        enabled_config, patient, provider,
    ):
        # Full flow: pay (→ paid), then the provider accepts (→ under_process),
        # which opens the channel — mirrors the appointment approval flow.
        monkeypatch.setenv('RAZORPAY_KEY_SECRET', self.SECRET)
        pu, pat = patient
        du, doc = provider
        order = self._make_order(tenant_id, pat, doc, product)
        pay = self._make_payment(tenant_id, order, pu)
        assert self._verify(app, client, pu, pay).status_code == 200

        # Provider accepts via the marketplace-sales endpoint.
        r = client.put(f'/api/v1/doctor/marketplace/sales/{order.id}',
                        json={'status': 'under_process'}, headers=self._hdr(app, du))
        assert r.status_code == 200
        from app.models import (PurchasedService, ServiceChannel,
                                 PurchasedServiceStatus)
        db.session.refresh(order)
        assert order.status == 'under_process'
        ps = PurchasedService.query.filter_by(
            tenant_id=tenant_id, order_id=order.id,
            status=PurchasedServiceStatus.ACTIVE).first()
        assert ps is not None
        assert ServiceChannel.query.filter_by(purchased_service_id=ps.id).first() is not None

    def test_cannot_pay_unless_pending(
        self, app, client, monkeypatch, db_session, tenant_id, product,
        enabled_config, patient, provider,
    ):
        monkeypatch.setenv('RAZORPAY_KEY_SECRET', self.SECRET)
        # The tenant-owned gateway gate runs BEFORE the order-status
        # check now (no platform fallback); stub a ready binding so the
        # request reaches the status logic this test is about.
        from unittest.mock import MagicMock
        monkeypatch.setattr(
            'app.api.common.payment.routes._tenant_binding_or_response',
            lambda tid: (MagicMock(key_id='rzp_test_x', key_secret=self.SECRET),
                         None),
        )
        pu, pat = patient
        _, doc = provider
        order = self._make_order(tenant_id, pat, doc, product, status='paid')
        r = client.post('/api/v1/payment/create-order', headers=self._hdr(app, pu),
                        json={'order_id': str(order.id)})
        assert r.status_code == 400  # already paid — can't pay again

    def test_payment_idempotent(
        self, app, client, monkeypatch, db_session, tenant_id, product,
        enabled_config, patient, provider,
    ):
        monkeypatch.setenv('RAZORPAY_KEY_SECRET', self.SECRET)
        pu, pat = patient
        _, doc = provider
        order = self._make_order(tenant_id, pat, doc, product)
        pay = self._make_payment(tenant_id, order, pu)
        rzp = f'rzp_{uuid.uuid4().hex}'  # same razorpay payment id → true retry
        r1 = self._verify(app, client, pu, pay, rzp)
        r2 = self._verify(app, client, pu, pay, rzp)
        assert r1.status_code == 200 and r2.status_code == 200
        db.session.refresh(order)
        assert order.status == 'paid'

    def test_payment_without_comm_config_still_marks_paid(
        self, app, client, monkeypatch, db_session, tenant_id, product,
        patient, provider,
    ):
        # No enabled_config fixture here → product has no communication.
        monkeypatch.setenv('RAZORPAY_KEY_SECRET', self.SECRET)
        pu, pat = patient
        _, doc = provider
        order = self._make_order(tenant_id, pat, doc, product)
        pay = self._make_payment(tenant_id, order, pu)
        r = self._verify(app, client, pu, pay)
        assert r.status_code == 200
        db.session.refresh(order)
        assert order.status == 'paid'

    def test_bad_signature_rejected(
        self, app, client, monkeypatch, db_session, tenant_id, product,
        enabled_config, patient, provider,
    ):
        monkeypatch.setenv('RAZORPAY_KEY_SECRET', self.SECRET)
        pu, pat = patient
        _, doc = provider
        order = self._make_order(tenant_id, pat, doc, product)
        pay = self._make_payment(tenant_id, order, pu)
        r = client.post('/api/v1/payment/verify', headers=self._hdr(app, pu), json={
            'razorpay_order_id': pay.gateway_order_id,
            'razorpay_payment_id': 'rz_pay_bad',
            'razorpay_signature': 'deadbeef', 'payment_id': str(pay.id),
        })
        assert r.status_code == 400
        db.session.refresh(order)
        assert order.status == 'pending'  # unchanged — not paid
