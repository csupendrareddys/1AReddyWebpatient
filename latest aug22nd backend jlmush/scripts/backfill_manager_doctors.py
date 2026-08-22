"""Throwaway: create placeholder Doctor records for the seeded clinic/hospital
managing users so they can use the full doctor ProfileSetting page. These are
NOT bookable providers — they're excluded from public search / admin lists /
provider counts by a User.role != DOCTOR filter (added separately)."""
from app import create_app
from app.extensions import db
from app.common.tenant_context import with_background_tenant_context
from app.common.encryption import hash_for_search
from app.models import User, Doctor, UserVerificationStatus

TID = '60f903af-61ac-4609-9f2c-08e379f9baed'
EMAILS = ['corp.hospital@seed.test', 'corp.clinic@seed.test']

app = create_app()
with with_background_tenant_context(app, TID):
    for email in EMAILS:
        u = User.query.filter_by(_email_hash=hash_for_search(email), tenant_id=TID, is_deleted=False).first()
        if not u:
            print('no user', email); continue
        if Doctor.query.filter_by(user_id=u.id, is_deleted=False).first():
            print('doctor exists for', email); continue
        d = Doctor(
            user_id=u.id, tenant_id=TID,
            # dummy values for the doctor-only NOT NULL columns (placeholder)
            aadhar_number='MANAGER-PLACEHOLDER',
            aadhar_attachment='placeholder',
            registration_number=f'MGR-{str(u.id)[:8]}',
            registration_certificate='placeholder',
            verification_status=UserVerificationStatus.PENDING,
            is_live=False,
        )
        db.session.add(d)
        print('created placeholder doctor for', email)
    db.session.commit()
    print('done')
