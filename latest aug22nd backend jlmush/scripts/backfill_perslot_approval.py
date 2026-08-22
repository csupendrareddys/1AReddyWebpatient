"""Backfill per-slot approval ids/status + approved_day_overrides.

Per-slot approval requires every JSON slot (weekly working_days and dated
day_overrides, plus their approved snapshots) to carry a stable ``id`` and an
``approval_status``. Existing rows predate that. This script stamps them and
populates the new ``approved_day_overrides`` snapshot:

  * approved_working_days / approved_day_overrides slots -> id + status 'approved'
  * live availability_config slots -> reuse the approved slot's id when content
    matches (so future diffs pair them), status 'approved'; otherwise a fresh id
    with status 'pending'.
  * approved_day_overrides is seeded from the doctor's live day_overrides ONLY
    for doctors currently APPROVED (their live overrides were already being
    shown to patients). Non-approved doctors start with an empty approved
    snapshot — their draft slots are treated as pending until an admin approves.

Idempotent: slots that already have an id keep it; re-running is a no-op.

Usage (inside the backend container):
  python scripts/backfill_perslot_approval.py            # DRY-RUN: report only
  python scripts/backfill_perslot_approval.py --apply    # commit
"""
import os
import sys

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from app import create_app
from app.extensions import db
from app.models import Doctor, AvailabilityApprovalStatus
from app.api.common.timeslot.slot_approval import (
    ensure_slot_id, slots_content_equal, set_status,
    APPROVAL_STATUS_APPROVED, APPROVAL_STATUS_PENDING,
)

APPLY = '--apply' in sys.argv

SCHED_TYPES = ("video", "audio", "chat", "home_visit", "clinic_visit", "camp")


def _stamp_approved(slots):
    """Give each slot in *slots* an id + approved status. Returns count."""
    n = 0
    for s in slots or []:
        if isinstance(s, dict):
            ensure_slot_id(s)
            set_status(s, APPROVAL_STATUS_APPROVED)
            n += 1
    return n


def _stamp_live(live_slots, approved_slots):
    """Stamp live slots: adopt approved id + 'approved' when content matches,
    else fresh id + 'pending'. Returns count stamped."""
    approved_slots = approved_slots or []
    used = set()
    n = 0
    for s in live_slots or []:
        if not isinstance(s, dict):
            continue
        match = None
        for a in approved_slots:
            if not isinstance(a, dict) or a.get('id') in used:
                continue
            if slots_content_equal(s, a):
                match = a
                break
        if match is not None:
            s['id'] = match.get('id') or ensure_slot_id(s)
            used.add(match.get('id'))
            set_status(s, APPROVAL_STATUS_APPROVED)
        else:
            ensure_slot_id(s)
            set_status(s, APPROVAL_STATUS_PENDING)
        n += 1
    return n


def _wh_days(wh):
    """Yield (day, slots_list) pairs from a working_days dict (modular or flat)."""
    if any(k in SCHED_TYPES for k in (wh or {}).keys()):
        for t, days in (wh or {}).items():
            if t in SCHED_TYPES and isinstance(days, dict):
                for day, slots in days.items():
                    if isinstance(slots, list):
                        yield (t, day), slots
    else:
        for day, slots in (wh or {}).items():
            if isinstance(slots, list):
                yield ('global', day), slots


def _wh_lookup(wh, key):
    t, day = key
    if t == 'global':
        return (wh or {}).get(day, [])
    return ((wh or {}).get(t, {}) or {}).get(day, [])


def main():
    app = create_app()
    with app.app_context():
        doctors = Doctor.query.filter_by(is_deleted=False).all()
        touched = 0

        for d in doctors:
            is_approved = d.availability_approval_status == AvailabilityApprovalStatus.APPROVED
            cfg = dict(d.availability_config or {})
            approved_wh = dict(d.approved_working_days or {})

            changed = False

            # 1. Stamp approved_working_days.
            for _key, slots in _wh_days(approved_wh):
                _stamp_approved(slots)

            # 2. Seed approved_day_overrides (only for APPROVED doctors).
            if d.approved_day_overrides is None:
                if is_approved:
                    import copy
                    approved_do = copy.deepcopy(cfg.get('day_overrides', {}) or {})
                    for _date, slots in approved_do.items():
                        _stamp_approved(slots)
                    d.approved_day_overrides = approved_do
                else:
                    d.approved_day_overrides = {}
                changed = True
            approved_do = d.approved_day_overrides or {}

            # 3. Stamp live working_days against approved.
            live_wh = cfg.get('working_days', {}) or {}
            for key, slots in _wh_days(live_wh):
                _stamp_live(slots, _wh_lookup(approved_wh, key))

            # 4. Stamp live day_overrides against approved.
            for date_str, slots in (cfg.get('day_overrides', {}) or {}).items():
                _stamp_live(slots, approved_do.get(date_str, []))

            # Persist mutated JSON (dict identity changed → assign back).
            d.approved_working_days = approved_wh
            d.availability_config = cfg
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(d, 'approved_working_days')
            flag_modified(d, 'availability_config')
            flag_modified(d, 'approved_day_overrides')
            touched += 1

            if APPLY:
                db.session.commit()
            else:
                db.session.rollback()

        print(f"{'APPLIED' if APPLY else 'DRY-RUN'}: processed {touched}/{len(doctors)} doctors")
        if not APPLY:
            print("Re-run with --apply to commit.")


if __name__ == '__main__':
    main()
