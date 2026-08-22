"""Idempotent demo seed for today's features — Patient Support Staff + Clinic
Branches. Makes the existing data demo-clean:

  * patient04's two caregivers get CONTRASTING roles (full vs view-only) so the
    "controlled permissions" story is visible at a glance.
  * qa.clinic02's Branch North is VERIFIED and Branch South stays PENDING, so
    both verification states show; Cara Desk keeps her Branch-North-only grant.

Run: docker exec -w /app jlmush-backend python scripts/seed_demo_today.py
"""
import sys
sys.path.insert(0, '/app')

from flask import g
from app import create_app
from app.extensions import db
from app.models import (
    User, Patient, PatientStaff, PatientStaffRole, PatientRole,
    Clinic, UserVerificationStatus,
)
from app.api.patient_family.service import PatientRoleService
from app.common.encryption import hash_for_search

app = create_app()
MODS = ['appointments', 'health_records', 'prescriptions', 'family_doctor', 'spending']


def by_email(e):
    return User.query.filter_by(_email_hash=hash_for_search(e)).first()


with app.test_request_context('/', headers={'Host': 'localhost'}):
    # ── Patient Support Staff (patient04) ────────────────────────────────────
    pu = by_email('patient04@platform-seed.test')
    p = Patient.query.filter_by(user_id=pu.id).first()
    g.tenant_id = p.tenant_id

    def ensure_role(name, matrix):
        role = PatientRole.query.filter_by(
            owner_patient_id=p.id, name=name, is_deleted=False).first()
        if not role:
            role = PatientRoleService.create(p.tenant_id, p.id, name)
        PatientRoleService.replace_matrix(role, matrix)
        return role

    full = ensure_role('Full caregiver',
                       [{'module': m, 'can_view': True, 'can_manage': True} for m in MODS])
    viewonly = ensure_role('View records only',
                           [{'module': m, 'can_view': True, 'can_manage': False}
                            for m in ('health_records', 'prescriptions')])

    def assign(email, role):
        u = by_email(email)
        s = PatientStaff.query.filter_by(patient_id=p.id, user_id=u.id).first()
        if not s:
            print('  (missing caregiver', email, ')'); return
        for a in s.role_assignments:
            a.is_active = (str(a.role_id) == str(role.id))
        if not any(str(a.role_id) == str(role.id) for a in s.role_assignments):
            db.session.add(PatientStaffRole(
                tenant_id=s.tenant_id, staff_id=s.id, role_id=role.id, is_active=True))
        db.session.commit()
        print(f'  {s.full_name} <{email}> -> {role.name}')

    print('Patient caregivers (patient04):')
    assign('aide02@platform-seed.test', full)
    assign('aide01@platform-seed.test', viewonly)

    # ── Clinic Branches (qa.clinic02) ────────────────────────────────────────
    cu = by_email('qa.clinic02@seed.test')
    c = Clinic.query.filter_by(admin_user_id=cu.id).first()
    g.tenant_id = c.tenant_id
    print('Clinic branches (qa.clinic02):')
    for b in Clinic.query.filter_by(parent_clinic_id=c.id, is_deleted=False).all():
        if 'North' in b.name:
            b.verification_status = UserVerificationStatus.VERIFIED
        # South stays pending on purpose.
        print(f'  {b.name} / {b.city} -> {b.verification_status.value}')
    db.session.commit()

    print('\nDemo data ready.')
