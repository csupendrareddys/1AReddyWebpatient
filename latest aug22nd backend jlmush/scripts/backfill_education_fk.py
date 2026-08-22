"""Backfill the queryable education FK stores from saved ProfileEducation JSON.

Existing doctors who filled the profile Education form BEFORE the write-through
(see DoctorService.save_education) have their specialization/degree only as name
snapshots in ProfileEducation.*_data JSON — the FK tables that search / cards /
prescriptions / gating read are empty, so those doctors are invisible to
specialization search. This script replays the same best-effort write-through
per doctor to populate the FK rows. It is idempotent (re-running is a no-op) and
only recovers what is actually stored — doctors whose JSON has no specialization
(e.g. signup-only, whose signup specialization was discarded by the old bug)
have nothing to recover.

Usage (run inside the backend container):
  python scripts/backfill_education_fk.py            # DRY-RUN (default): report only
  python scripts/backfill_education_fk.py --apply    # commit the rows

Dry-run isolates each doctor in its own transaction and rolls it back, so it
never writes; --apply commits per doctor.
"""
import sys

from app import create_app
from app.extensions import db
from app.api.service_provider.doctor.service import DoctorService
from app.models import ProfileEducation, Category
from app.models.catalog import CATEGORY_TYPE_SPECIALIZATION
from app.models.profile_shared import (
    ProfileEducationSpecialization, ProfileEducationDegree,
)

APPLY = '--apply' in sys.argv
SECTIONS = ('graduation_data', 'post_graduation_data',
            'super_speciality_data', 'other_certification_data')


def _resolves(tid, name):
    n = (name or '').strip() if isinstance(name, str) else ''
    if not n:
        return None
    c = (Category.query
         .filter(Category.tenant_id == tid,
                 Category.category_type == CATEGORY_TYPE_SPECIALIZATION,
                 db.func.lower(Category.name) == n.lower())
         .order_by(Category.is_active.desc())
         .first())
    return c is not None


def main():
    app = create_app()
    with app.app_context():
        records = (ProfileEducation.query
                   .filter(ProfileEducation.doctor_id.isnot(None))
                   .all())
        docs_total = len(records)
        docs_touched = specs_added = degs_added = 0
        unresolved = {}   # name -> count

        for rec in records:
            # Report unresolved specialization names (present but no Category match)
            for attr in SECTIONS:
                data = getattr(rec, attr, None) or {}
                nm = (data.get('specialization') or '').strip() if isinstance(data.get('specialization'), str) else ''
                if nm and not _resolves(rec.tenant_id, nm):
                    unresolved[nm] = unresolved.get(nm, 0) + 1
            try:
                DoctorService._sync_education_fk_from_json(rec)
            except Exception as e:  # noqa: BLE001
                db.session.rollback()
                print(f'  ERROR doctor={rec.doctor_id}: {e}')
                continue
            new_specs = [o for o in db.session.new if isinstance(o, ProfileEducationSpecialization)]
            new_degs = [o for o in db.session.new if isinstance(o, ProfileEducationDegree)]
            if new_specs or new_degs:
                docs_touched += 1
                specs_added += len(new_specs)
                degs_added += len(new_degs)
            if APPLY:
                db.session.commit()
            else:
                db.session.rollback()

        mode = 'APPLIED' if APPLY else 'DRY-RUN (no changes written)'
        print('=' * 60)
        print(f'Backfill education FK — {mode}')
        print(f'  ProfileEducation records scanned : {docs_total}')
        print(f'  doctors with rows to add         : {docs_touched}')
        print(f'  specialization FK rows to add    : {specs_added}')
        print(f'  degree FK rows to (re)write      : {degs_added}')
        if unresolved:
            print(f'  unresolved specialization names  : {len(unresolved)} distinct')
            for nm, cnt in sorted(unresolved.items(), key=lambda x: -x[1]):
                print(f'      - {nm!r} (x{cnt})  [no matching Category — skipped]')
        else:
            print('  unresolved specialization names  : none')
        print('=' * 60)


if __name__ == '__main__':
    main()
