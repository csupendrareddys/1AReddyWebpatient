"""Per-slot approval helpers for doctor availability.

Slots live in two JSON locations on the Doctor row:
  * ``availability_config['working_days'][<type>][<DayName>]`` — weekly windows
  * ``availability_config['day_overrides'][<date>]``           — dated slots

For per-slot approval each slot object carries a stable ``id`` and an
``approval_status`` (``pending`` | ``approved`` | ``rejected``). These helpers
assign ids, compare slots by *content* (ignoring id/status metadata) and diff a
draft slot list against its approved counterpart so approval can act on
individual slots instead of whole JSON slices.

Security note: a slot's authoritative status is derived here from whether its
content matches the approved snapshot — never trusted from the client. A client
that labels a changed slot ``approved`` is forced back to ``pending``.
``rejected`` is honoured only to avoid auto-resubmitting an unchanged rejected
slot (it just keeps the doctor's own slot hidden, so it is not a bypass).
"""
import json
import uuid

APPROVAL_STATUS_PENDING = 'pending'
APPROVAL_STATUS_APPROVED = 'approved'
APPROVAL_STATUS_REJECTED = 'rejected'

# Fields that define a slot's *content* (what an admin actually approves).
# ``id`` and ``approval_status`` are metadata and excluded from comparison.
_CONTENT_KEYS = (
    'start', 'end', 'size', 'duration', 'gap',
    'consultation_types', 'consultationTypes',
)


def ensure_slot_id(slot):
    """Assign a uuid ``id`` to *slot* in place if missing. Returns the id."""
    if not slot.get('id'):
        slot['id'] = str(uuid.uuid4())
    return slot['id']


def slot_content(slot):
    """Content-only view of *slot* for equality (excludes id/status)."""
    return {k: slot[k] for k in _CONTENT_KEYS if k in slot}


def slots_content_equal(a, b):
    """True if two slots describe the same timing/types (ignoring id/status)."""
    return (
        json.dumps(slot_content(a), sort_keys=True)
        == json.dumps(slot_content(b), sort_keys=True)
    )


def set_status(slot, status):
    """Set ``approval_status`` on *slot* in place. Returns the slot."""
    slot['approval_status'] = status
    return slot


def diff_slot_lists(live_slots, approved_slots):
    """Diff draft *live_slots* against *approved_slots* for one location.

    Pairs slots by ``id`` (adopting an approved slot's id when content matches,
    so pre-id data still pairs up), assigns ids where missing, and stamps
    ``approval_status`` on each live slot in place.

    Returns a dict with four lists of live/approved slot objects::

        {
          'changed':   [...],  # new or content-changed -> need approval (pending)
          'unchanged': [...],  # already match approved  -> stay approved
          'rejected':  [...],  # client-marked rejected, unchanged -> no request
          'removed':   [...],  # approved slots no longer present live -> removal approval
        }
    """
    live_slots = live_slots or []
    approved_slots = approved_slots or []
    approved_by_id = {s['id']: s for s in approved_slots if isinstance(s, dict) and s.get('id')}
    used_approved_ids = set()

    changed, unchanged, rejected = [], [], []

    for slot in live_slots:
        if not isinstance(slot, dict):
            continue
        incoming_status = slot.get('approval_status')
        sid = slot.get('id')
        match = approved_by_id.get(sid) if sid else None

        # No id-match — try to adopt an unused approved slot with identical
        # content (handles data written before ids existed).
        if match is None:
            for a in approved_slots:
                if not isinstance(a, dict) or a.get('id') in used_approved_ids:
                    continue
                if slots_content_equal(slot, a):
                    match = a
                    slot['id'] = a.get('id') or ensure_slot_id(slot)
                    break

        if match is not None and slots_content_equal(slot, match):
            used_approved_ids.add(match.get('id'))
            slot['id'] = match.get('id') or ensure_slot_id(slot)
            set_status(slot, APPROVAL_STATUS_APPROVED)
            unchanged.append(slot)
            continue

        if match is not None:
            used_approved_ids.add(match.get('id'))

        ensure_slot_id(slot)
        if incoming_status == APPROVAL_STATUS_REJECTED:
            # Untouched rejected slot — leave rejected, don't re-request.
            set_status(slot, APPROVAL_STATUS_REJECTED)
            rejected.append(slot)
        else:
            set_status(slot, APPROVAL_STATUS_PENDING)
            changed.append(slot)

    removed = [
        a for a in approved_slots
        if isinstance(a, dict) and a.get('id') and a['id'] not in used_approved_ids
    ]
    return {
        'changed': changed,
        'unchanged': unchanged,
        'rejected': rejected,
        'removed': removed,
    }


def find_slot_by_id(slots, slot_id):
    """Return (index, slot) for *slot_id* in *slots*, or (None, None)."""
    for i, s in enumerate(slots or []):
        if isinstance(s, dict) and s.get('id') == slot_id:
            return i, s
    return None, None


def _mark_live_slot_approved(doctor, section, keys, slot_id):
    """Flip the matching live-draft slot's status to approved (cosmetic — patient
    visibility follows the approved snapshot). *keys* walks into
    availability_config[section] to reach the slot list."""
    from sqlalchemy.orm.attributes import flag_modified
    cfg = doctor.availability_config or {}
    node = cfg.get(section, {}) or {}
    parent = node
    for k in keys[:-1]:
        parent = parent.get(k, {}) or {}
    live_list = parent.get(keys[-1], []) if keys else []
    _, lslot = find_slot_by_id(live_list, slot_id)
    if lslot is not None:
        set_status(lslot, APPROVAL_STATUS_APPROVED)
        doctor.availability_config = cfg
        flag_modified(doctor, 'availability_config')


def promote_availability_change(doctor, meta, app_data):
    """Apply ONE granular pricing / working-hours change straight into the
    doctor's APPROVED snapshot — the exact mirror of what an admin approval does
    (see ApprovalService.apply_doctor_availability_sync). Used by the
    approval-matrix 'auto' path so an auto-approved change goes live with no
    pending request. Idempotent per (meta, data). Caller commits."""
    from sqlalchemy.orm.attributes import flag_modified
    meta = meta or {}
    cat = meta.get('category')
    typ = meta.get('type')
    slot_id = meta.get('slot_id')
    deleted = isinstance(app_data, dict) and app_data.get('_deleted')

    if cat == 'pricing' and app_data is not None:
        curr = [p for p in (doctor.approved_slot_pricing or [])
                if p.get('consultation_type', 'complete') != typ]
        curr.extend(app_data)
        doctor.approved_slot_pricing = curr
        flag_modified(doctor, 'approved_slot_pricing')
        return

    if cat == 'working_hours' and slot_id:
        day = meta.get('day')
        curr_wh = dict(doctor.approved_working_days or {})
        if typ == 'global':
            day_list = list(curr_wh.get(day, []) or [])
        else:
            type_map = dict(curr_wh.get(typ, {}) or {})
            day_list = list(type_map.get(day, []) or [])
        idx, _ = find_slot_by_id(day_list, slot_id)
        if deleted:
            if idx is not None:
                day_list.pop(idx)
        else:
            new_slot = set_status(dict(app_data), APPROVAL_STATUS_APPROVED)
            if idx is not None:
                day_list[idx] = new_slot
            else:
                day_list.append(new_slot)
        if typ == 'global':
            if day_list:
                curr_wh[day] = day_list
            else:
                curr_wh.pop(day, None)
        else:
            if day_list:
                type_map[day] = day_list
            else:
                type_map.pop(day, None)
            curr_wh[typ] = type_map
        doctor.approved_working_days = curr_wh
        flag_modified(doctor, 'approved_working_days')
        if not deleted:
            _mark_live_slot_approved(
                doctor, 'working_days',
                [day] if typ == 'global' else [typ, day], slot_id)
        return

    if cat == 'working_hours' and app_data is not None:
        # Legacy whole-slice fallback (pre per-slot requests).
        curr_wh = dict(doctor.approved_working_days or {})
        if typ == 'global':
            curr_wh = app_data
        else:
            curr_wh[typ] = app_data
        doctor.approved_working_days = curr_wh
        flag_modified(doctor, 'approved_working_days')
        return

    # ── Calendar: one dated day-override slot into approved_day_overrides.
    # Mirrors the admin approve path (rbac/services.py) so an auto-approval
    # doctor's dated slot edits go live without an admin queue. The schedule
    # save re-materialises approved_day_overrides → bookable TimeSlot rows. ──
    if cat == 'calendar' and slot_id:
        date_str = meta.get('date')
        curr_do = dict(doctor.approved_day_overrides or {})
        day_list = list(curr_do.get(date_str, []) or [])
        idx, _ = find_slot_by_id(day_list, slot_id)
        if deleted:
            if idx is not None:
                day_list.pop(idx)
        else:
            new_slot = set_status(dict(app_data), APPROVAL_STATUS_APPROVED)
            if idx is not None:
                day_list[idx] = new_slot
            else:
                day_list.append(new_slot)
        # Keep the date key even when empty — an empty list means "day blocked",
        # which materialize_day_overrides honours by clearing that date's slots.
        curr_do[date_str] = day_list
        doctor.approved_day_overrides = curr_do
        flag_modified(doctor, 'approved_day_overrides')
        if not deleted:
            _mark_live_slot_approved(doctor, 'day_overrides', [date_str], slot_id)
        return

    if cat == 'calendar' and app_data is not None:
        # Legacy whole-slice fallback → approved snapshot.
        doctor.approved_day_overrides = app_data
        flag_modified(doctor, 'approved_day_overrides')
        return

    # ── Global availability config (slot_size / slot_gap / exceptions). ──
    if cat == 'global_config' and app_data is not None:
        curr_tgt = dict(doctor.availability_config or {})
        curr_tgt.update(app_data)
        doctor.availability_config = curr_tgt
        flag_modified(doctor, 'availability_config')
        return
