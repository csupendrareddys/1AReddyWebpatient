"""Care-team write-path helpers, shared by both landing stacks.

The tenant stack (``feature_doctors``) and the apex stack
(``platform_feature_doctors``) store the same thing — one row per
(feature, doctor) with a boolean per revealable field — so the reconcile and
candidate-listing logic lives here rather than being written twice.

The only difference is scoping: tenant rows carry a ``tenant_id`` column and
are RLS-isolated, while platform rows carry none. Both validate the doctor ids
against a tenant, though: the apex care team draws from the default tenant
(the platform owner's own), so neither stack can be used to surface another
clinic's doctors.
"""
from app.extensions import db
from app.models import Doctor


def sync_care_team(feature, entries, model_cls, tenant_id,
                   store_tenant_id=True, strict=True):
    """Replace ``feature``'s care team with ``entries`` (list of dicts).

    Reconciles by ``doctor_id`` rather than wiping and re-inserting, so a row's
    id survives an edit that only flips a toggle.

    ``tenant_id`` scopes which doctors may be referenced. ``store_tenant_id``
    controls whether it is also written onto the row — true for the tenant
    stack, false for the platform stack whose tables have no such column.

    With ``strict`` (the admin write path) an unknown doctor raises
    ``LookupError``. Without it (snapshot restore) unknown doctors are dropped,
    so a doctor deleted since the snapshot can't fail the whole restore.
    """
    from app.models import MarketplaceServiceGroup

    entries = entries or []

    # A row pins EITHER a doctor OR a team (group offering). Key each wanted
    # entry as ('doctor'|'team', id) so the two kinds never collide.
    wanted = {}
    for order, entry in enumerate(entries):
        team_id = entry.get('team_id')
        doctor_id = entry.get('doctor_id')
        if team_id:
            wanted.setdefault(('team', str(team_id)), (order, entry))
        elif doctor_id:
            # Later duplicates collapse onto the first — the (feature, doctor)
            # unique constraint would reject them anyway.
            wanted.setdefault(('doctor', str(doctor_id)), (order, entry))

    want_doctors = {k[1] for k in wanted if k[0] == 'doctor'}
    want_teams = {k[1] for k in wanted if k[0] == 'team'}

    if want_doctors:
        valid = {
            str(d_id) for (d_id,) in db.session.query(Doctor.id).filter(
                Doctor.tenant_id == tenant_id,
                Doctor.id.in_(list(want_doctors)),
            ).all()
        }
        missing = want_doctors - valid
        if missing and strict:
            # Phrased as a resource name — not_found_response() appends
            # " not found" to whatever it's handed.
            raise LookupError(f"Doctor(s) {', '.join(sorted(missing))}")
        for d_id in missing:
            wanted.pop(('doctor', d_id), None)

    if want_teams:
        valid_t = {
            str(g_id) for (g_id,) in db.session.query(MarketplaceServiceGroup.id).filter(
                MarketplaceServiceGroup.tenant_id == tenant_id,
                MarketplaceServiceGroup.id.in_(list(want_teams)),
            ).all()
        }
        missing_t = want_teams - valid_t
        if missing_t and strict:
            raise LookupError(f"Team(s) {', '.join(sorted(missing_t))}")
        for g_id in missing_t:
            wanted.pop(('team', g_id), None)

    def _key(row):
        return ('team', str(row.team_id)) if getattr(row, 'team_id', None) \
            else ('doctor', str(row.doctor_id))

    existing = {_key(row): row for row in feature.care_team}

    for key, (order, entry) in wanted.items():
        row = existing.get(key)
        if row is None:
            kwargs = {'team_id': key[1]} if key[0] == 'team' else {'doctor_id': key[1]}
            if store_tenant_id:
                kwargs['tenant_id'] = tenant_id
            row = model_cls(**kwargs)
            feature.care_team.append(row)
        # Toggles/description are doctor-only; harmless (all-false) on a team row.
        for flag in model_cls.TOGGLES:
            setattr(row, flag, bool(entry.get(flag, False)))
        row.description = entry.get('description')
        # Fall back to payload order so the admin's drag-and-drop ordering
        # works even when the client doesn't send explicit display_order.
        row.display_order = entry.get('display_order') or order

    for key, row in existing.items():
        if key not in wanted:
            feature.care_team.remove(row)


def clone_care_team(source, target, model_cls, store_tenant_id=True, tenant_id=None):
    """Copy a feature's care-team link rows onto a cloned feature."""
    for row in source.care_team:
        kwargs = {
            'doctor_id': row.doctor_id,
            'team_id': getattr(row, 'team_id', None),
            'description': row.description,
            'display_order': row.display_order,
        }
        if store_tenant_id:
            kwargs['tenant_id'] = tenant_id
        for flag in model_cls.TOGGLES:
            kwargs[flag] = getattr(row, flag)
        target.care_team.append(model_cls(**kwargs))


def list_care_team_candidates(tenant_id, search=None):
    """Doctors in ``tenant_id`` that can be pinned to a feature page.

    Returns the same shape the care-team card renders, ignoring toggles — the
    editor previews every field so the admin can see what turning each switch
    on would reveal.
    """
    from app.models import User
    from app.models.profile_shared import ProfileAbout

    q = (
        db.session.query(Doctor)
        .join(User, Doctor.user_id == User.id)
        .filter(Doctor.tenant_id == tenant_id)
    )
    if search:
        like = f'%{search}%'
        q = q.filter(db.or_(
            User.first_name.ilike(like), User.last_name.ilike(like),
        ))
    doctors = q.order_by(User.first_name, User.last_name).all()
    if not doctors:
        return []

    abouts = {
        row.doctor_id: row
        for row in ProfileAbout.query.filter(
            ProfileAbout.doctor_id.in_([d.id for d in doctors])
        ).all()
    }

    out = []
    for doc in doctors:
        user = doc.user
        addr = doc.communication_address or {}
        about = abouts.get(doc.id)
        cat = getattr(about, 'work_qualification', None)
        out.append({
            'id': str(doc.id),
            'name': ' '.join(
                p for p in (
                    (user.first_name if user else None),
                    (user.last_name if user else None),
                ) if p
            ).strip() or None,
            'photo': user.profile_image if user else None,
            'experience_years': doc.experience_years,
            'languages': doc.languages_known or [],
            'location': (
                addr.get('current_city') or addr.get('city')
                if isinstance(addr, dict) else None
            ),
            'work_qualification': cat.name if cat else None,
        })
    return out
