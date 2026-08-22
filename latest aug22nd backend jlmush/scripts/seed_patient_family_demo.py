"""Seed a ready-to-test Patient Family demo on two existing seed patients.

Idempotent. Sets up:
  * GUARDIAN  = patient03@platform-seed.test  (owner)
  * SIBLING   = patient01@platform-seed.test  (reciprocal linked adult)

Both put on the family-enabled "Patient Care" receiver plan (active, 1-year
period) with quotas 3 minors / 5 links / 5 roles. Creates:
  * a minor sub-profile under the guardian ("Aarav <Guardian surname>")
  * a reciprocal family link guardian <-> sibling (if not already present)
  * a role "Can view & book" (appointments view+manage, health records view),
    owned by the guardian and granted to the sibling — so the sibling can
    "open" the guardian's account, role-bounded.

Finally clears all Redis/DB sessions for both accounts + an admin so the login
is clean, and prints credentials + a test guide.

Run:  docker compose exec -w /app -e PYTHONPATH=/app backend python scripts/seed_patient_family_demo.py
"""
from datetime import timedelta

from app import create_app
from app.extensions import db
from app.models import (
    Patient, User, HouseGroupMember, MembershipVertical, PatientFamilyPolicy,
    PatientRole,
)
from app.models._base import utcnow
from app.models._enums import MembershipSubscriptionStatus

PLAN_ID = '853e3e8f-adc3-4883-8adb-398ff46710ed'  # "Patient Care" (receiver)
GUARDIAN_EMAIL = 'patient03@platform-seed.test'
SIBLING_EMAIL = 'patient01@platform-seed.test'
PASSWORD = 'Demo@1234'


def _patient_by_email(email):
    from app.common.encryption import hash_for_search
    u = User.query.filter_by(_email_hash=hash_for_search(email)).first()
    if not u:
        raise SystemExit(f'User {email} not found — is the base seed loaded?')
    p = Patient.query.filter_by(user_id=u.id).first()
    return u, p


def _ensure_membership(patient):
    from app.api.membership.service import MembershipSubscriptionService
    sub = MembershipSubscriptionService.resolve_for_provider(
        patient.tenant_id, MembershipVertical.PATIENT, patient.id)
    if not sub or str(sub.membership_plan_id) != PLAN_ID:
        sub = MembershipSubscriptionService.assign_plan_for_provider(
            patient.tenant_id, MembershipVertical.PATIENT, patient.id, PLAN_ID)
    now = utcnow()
    sub.status = MembershipSubscriptionStatus.ACTIVE
    sub.current_period_start = now
    sub.current_period_end = now + timedelta(days=365)
    sub.trial_ends_at = None
    return sub


def _ensure_policy(tenant_id):
    pol = PatientFamilyPolicy.query.filter_by(
        tenant_id=tenant_id, plan_id=PLAN_ID).first()
    if not pol:
        pol = PatientFamilyPolicy(tenant_id=tenant_id, plan_id=PLAN_ID)
        db.session.add(pol)
    pol.max_minor_subaccounts = 3
    pol.max_family_links = 5
    pol.max_patient_roles = 5
    pol.is_active = True
    return pol


def _ensure_link(guardian, guardian_user, sibling, sibling_user):
    """A reciprocal adult link between guardian and sibling (both member rows)."""
    g_side = HouseGroupMember.query.filter_by(
        tenant_id=guardian.tenant_id, patient_id=guardian.id,
        linked_user_id=sibling_user.id, is_child_account=False).first()
    if not g_side:
        g_side = HouseGroupMember(
            patient_id=guardian.id, relation='Brother',
            first_name=sibling_user.first_name or 'Sibling',
            last_name=sibling_user.last_name or '',
            linked_user_id=sibling_user.id, linked_patient_id=sibling.id,
            group_type='family',
            permissions={'visible': True, 'appointments': False, 'prescriptions': False},
        )
        db.session.add(g_side)
    s_side = HouseGroupMember.query.filter_by(
        tenant_id=sibling.tenant_id, patient_id=sibling.id,
        linked_user_id=guardian_user.id, is_child_account=False).first()
    if not s_side:
        s_side = HouseGroupMember(
            patient_id=sibling.id, relation='Brother',
            first_name=guardian_user.first_name or 'Guardian',
            last_name=guardian_user.last_name or '',
            linked_user_id=guardian_user.id, linked_patient_id=guardian.id,
            group_type='family',
            permissions={'visible': True, 'appointments': False, 'prescriptions': False},
        )
        db.session.add(s_side)
    db.session.flush()
    return g_side, s_side


def _ensure_minor(guardian, guardian_user):
    from app.api.service_reciever.patient.service import HouseGroupService
    existing = HouseGroupMember.query.filter_by(
        tenant_id=guardian.tenant_id, patient_id=guardian.id,
        is_child_account=True, is_active=True, first_name='Aarav').first()
    if existing:
        return existing
    member, _minor = HouseGroupService.add_minor(guardian, {
        'first_name': 'Aarav', 'last_name': guardian_user.last_name or 'Kumar',
        'relation': 'Son', 'gender': 'MALE',
    })
    return member


def _ensure_role(guardian, g_side_member):
    from app.api.patient_family.service import PatientRoleService
    role = PatientRole.query.filter_by(
        tenant_id=guardian.tenant_id, owner_patient_id=guardian.id,
        name='Can view & book', is_deleted=False).first()
    if not role:
        role = PatientRoleService.create(
            guardian.tenant_id, guardian.id, 'Can view & book',
            'Book appointments and view health records on my behalf.')
    PatientRoleService.replace_matrix(role, [
        {'module': 'appointments', 'can_view': True, 'can_manage': True},
        {'module': 'health_records', 'can_view': True, 'can_manage': False},
    ])
    # Grant it to the sibling (the guardian-side member row).
    g_side_member.role_id = role.id
    return role


def _clear_sessions(*emails):
    from app.auth.session_store import SessionStore
    for email in emails:
        try:
            u, _ = _patient_by_email(email)
        except SystemExit:
            continue
        try:
            SessionStore.delete_all_user_sessions(str(u.id))
        except Exception as e:  # noqa
            print(f'  (session clear for {email} skipped: {e})')


def _clear_admin_sessions():
    from app.auth.session_store import SessionStore
    from app.common.encryption import hash_for_search
    for n in range(1, 6):
        u = User.query.filter_by(
            _email_hash=hash_for_search(f'super_admin0{n}@platform-seed.test')).first()
        if u:
            try:
                SessionStore.delete_all_user_sessions(str(u.id))
            except Exception:  # noqa
                pass


# A small reciprocal "family web" so EVERY demo account shows populated
# linked-family data (both "Family who can act for me" AND "Accounts I can
# open"), not just one guardian/sibling pair.
def _e(n):
    return f'patient0{n}@platform-seed.test'


PAIRS = [(3, 1), (4, 5), (4, 2), (1, 5)]   # each becomes a two-way linked+role pair

app = create_app()
with app.test_request_context('/', headers={'Host': 'localhost'}):
    from flask import g
    # tenant from any patient
    _, anchor = _patient_by_email(_e(1))
    g.tenant_id = anchor.tenant_id
    _ensure_policy(anchor.tenant_id)

    linked = set()
    for a_n, b_n in PAIRS:
        a_user, a = _patient_by_email(_e(a_n))
        b_user, b = _patient_by_email(_e(b_n))
        _ensure_membership(a)
        _ensure_membership(b)
        # Reciprocal link + a role granted in BOTH directions.
        a_side, b_side = _ensure_link(a, a_user, b, b_user)
        _ensure_role(a, a_side)   # a grants b → b can open a
        _ensure_role(b, b_side)   # b grants a → a can open b
        linked.update([a_n, b_n])

    # A minor under each guardian in the web (idempotent by name).
    for n in sorted(linked):
        u, p = _patient_by_email(_e(n))
        _ensure_minor(p, u)

    db.session.commit()
    _clear_sessions(*[_e(n) for n in range(1, 6)])
    _clear_admin_sessions()

    print('\n' + '=' * 62)
    print(' PATIENT FAMILY DEMO — SEEDED (reciprocal web)')
    print('=' * 62)
    print('  Logins (password %s): patient01..05@platform-seed.test' % PASSWORD)
    print('  Reciprocal linked+role pairs:', PAIRS)
    print('  Each linked patient has: minors, "Family who can act for me"')
    print('  (assignable linked adults) AND "Accounts I can open" (role-granted).')
    print('  Plan: Patient Care (minors=3, links=5, roles=5).')
    print('=' * 62)
