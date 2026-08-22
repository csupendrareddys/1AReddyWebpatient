# Centralizing profile details across Doctor / Admin / Clinic / Hospital

**Goal:** all four actors have essentially the *same* profile details, but today they don't share storage. Give them **one** way to store profile details.

**Scope (deliberately narrow):** only the six common profile sub-tables. **Do not touch actor identity tables** (`doctors`/`admins`/`clinics`/`hospitals`) or their FK graph. The clinic/hospital statutory `entity_profiles` (registration/CIN/GST/PAN) stays separate — that's data doctor/admin don't have.

The six sub-tables (all in `app/models/profile_shared.py`):
`profile_signatures`, `profile_about`, `profile_education`, `profile_bank_accounts`, `profile_declaration_responses`, `profile_documents`.

## Current state (from exploration)

| | doctor | admin | auth-personnel | clinic | hospital |
|---|:-:|:-:|:-:|:-:|:-:|
| 6 profile sub-tables | ✅ | ✅ | education only | ❌ | ❌ |

Each sub-table repeats the same ownership machinery: nullable `doctor_id` + `admin_id` (+ `authorized_personnel_id` on education), an `exactly_one_owner` CHECK, per-owner UNIQUEs, and `entity_type`/`entity_id` computed props. That's the **same pattern duplicated 6×**, and clinic/hospital can't participate at all.

## Target design — a `profile_owner` table that the actor FKs point *into*

Resolve ownership in **one** place. The four actor tables stay untouched (honors the scope); the sprawl collapses from 6 copies to 1; each sub-table gets a single clean `profile_owner_id`.

```
profile_owner                                    ← NEW
  id UUID PK
  tenant_id UUID NOT NULL → tenants               (TenantMixin + RLS)
  owner_type VARCHAR(20) NOT NULL                 -- 'doctor'|'admin'|'clinic'|'hospital'|'authorized_personnel'
  doctor_id               UUID NULL → doctors.doctor_id            ON DELETE CASCADE
  admin_id                UUID NULL → admins.admin_id              ON DELETE CASCADE
  clinic_id               UUID NULL → clinics.id                   ON DELETE CASCADE
  hospital_id             UUID NULL → hospitals.hospital_id        ON DELETE CASCADE
  authorized_personnel_id UUID NULL → authorized_personnel.id      ON DELETE CASCADE
  CHECK exactly one of the five FKs set            -- ck_profile_owner_exactly_one_owner (CASE-sum = 1)
  UNIQUE (tenant_id, doctor_id) … one per actor FK  -- ≤1 owner row per actor (NULLs don't collide, so fine)

each of the 6 sub-tables:
  + profile_owner_id UUID → profile_owner.id ON DELETE CASCADE
  − doctor_id / admin_id / authorized_personnel_id   (dropped at the end)
  − ck_*_exactly_one_owner                            (dropped — now lives once, on profile_owner)
  new UNIQUE (tenant_id, profile_owner_id) [+ config_id for declarations/documents; + order_index for bank]
```

**Why this shape:** honors "only profile details" (actor tables untouched); preserves full FK integrity + RLS (unlike the polymorphic pattern this repo already abandoned); makes all six tables support all owner types uniformly, so clinic/hospital become first-class owners and education's `authorized_personnel` stops being a special case; adding a 5th actor later = one nullable FK on `profile_owner`, nothing else.

## Rollout: expand → backfill → cut → contract (each phase verified in the live app before commit)

### Phase A — expand (additive; no behavior change)

1. New `ProfileOwner` model (mirror `ProfileEducation`'s style in `profile_shared.py`):

```python
class ProfileOwner(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = 'profile_owner'
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_type = db.Column(db.String(20), nullable=False)  # doctor|admin|clinic|hospital|authorized_personnel

    doctor_id               = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),  nullable=True, index=True)
    admin_id                = db.Column(UUID(as_uuid=True), db.ForeignKey('admins.admin_id',   ondelete='CASCADE'),  nullable=True, index=True)
    clinic_id               = db.Column(UUID(as_uuid=True), db.ForeignKey('clinics.id',        ondelete='CASCADE'),  nullable=True, index=True)
    hospital_id             = db.Column(UUID(as_uuid=True), db.ForeignKey('hospitals.hospital_id', ondelete='CASCADE'), nullable=True, index=True)
    authorized_personnel_id = db.Column(UUID(as_uuid=True), db.ForeignKey('authorized_personnel.id', ondelete='CASCADE'), nullable=True, index=True)

    # to the six sub-tables
    signatures            = db.relationship('ProfileSignature',           back_populates='profile_owner', cascade='all, delete-orphan')
    about                 = db.relationship('ProfileAbout',               back_populates='profile_owner', cascade='all, delete-orphan')
    education             = db.relationship('ProfileEducation',           back_populates='profile_owner', cascade='all, delete-orphan')
    bank_accounts         = db.relationship('ProfileBankAccount',         back_populates='profile_owner', cascade='all, delete-orphan')
    declaration_responses = db.relationship('ProfileDeclarationResponse', back_populates='profile_owner', cascade='all, delete-orphan')
    documents             = db.relationship('ProfileDocument',            back_populates='profile_owner', cascade='all, delete-orphan')

    # back to actors (uselist=False)
    doctor   = db.relationship('Doctor',   back_populates='profile_owner')
    admin    = db.relationship('Admin',    back_populates='profile_owner')
    clinic   = db.relationship('Clinic',   back_populates='profile_owner')
    hospital = db.relationship('Hospital', back_populates='profile_owner')

    __table_args__ = (
        CheckConstraint(
            '(CASE WHEN doctor_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN admin_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN clinic_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN hospital_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN authorized_personnel_id IS NOT NULL THEN 1 ELSE 0 END) = 1',
            name='ck_profile_owner_exactly_one_owner',
        ),
        UniqueConstraint('tenant_id', 'doctor_id',   name='uq_profile_owner_tenant_doctor'),
        UniqueConstraint('tenant_id', 'admin_id',    name='uq_profile_owner_tenant_admin'),
        UniqueConstraint('tenant_id', 'clinic_id',   name='uq_profile_owner_tenant_clinic'),
        UniqueConstraint('tenant_id', 'hospital_id', name='uq_profile_owner_tenant_hospital'),
        UniqueConstraint('tenant_id', 'authorized_personnel_id', name='uq_profile_owner_tenant_personnel'),
    )
```

Export it in `app/models/__init__.py`.

2. On each of the six sub-tables add (keep the old owner columns for now):
```python
profile_owner_id = db.Column(UUID(as_uuid=True), db.ForeignKey('profile_owner.id', ondelete='CASCADE'), nullable=True, index=True)
profile_owner    = db.relationship('ProfileOwner', back_populates='<signatures|about|...>')
```

3. On `Doctor`/`Admin`/`Clinic`/`Hospital` add only a reverse relationship (no column):
```python
profile_owner = db.relationship('ProfileOwner', back_populates='<doctor|admin|clinic|hospital>', uselist=False)
```

4. Migration: `op.create_table('profile_owner', …)` then `for stmt in generate_rls_sql('profile_owner'): op.execute(stmt)`; `op.add_column(...)` the nullable `profile_owner_id` on the six tables. `flask db upgrade`; app boots, nothing else changes.

### Phase B — backfill migration (raw SQL via `op.get_bind()`; cross-tenant, RLS bypassed; idempotent)

```sql
-- one owner row per existing actor (repeat block per actor type)
INSERT INTO profile_owner (id, tenant_id, owner_type, doctor_id, created_at, updated_at)
SELECT gen_random_uuid(), d.tenant_id, 'doctor', d.doctor_id, now(), now()
FROM doctors d
ON CONFLICT (tenant_id, doctor_id) DO NOTHING;
-- … admins ('admin', admin_id), authorized_personnel ('authorized_personnel', id),
--    clinics ('clinic', id), hospitals ('hospital', hospital_id) …

-- point each sub-table row at its owner (repeat per sub-table)
UPDATE profile_signatures s SET profile_owner_id = o.id
FROM profile_owner o
WHERE o.tenant_id = s.tenant_id
  AND ((s.doctor_id IS NOT NULL AND o.doctor_id = s.doctor_id)
    OR (s.admin_id  IS NOT NULL AND o.admin_id  = s.admin_id));
-- profile_education additionally matches o.authorized_personnel_id = s.authorized_personnel_id
```
Verify: every sub-table row now has a non-null `profile_owner_id` (count check). `downgrade` = no-op with a warning.

### Phase C — cut writers/readers to `profile_owner_id`

- Add one helper, route all writers through it:
```python
def get_or_create_profile_owner(actor, owner_type):
    tid = current_tenant_id_strict()
    fk = {'doctor':'doctor_id','admin':'admin_id','clinic':'clinic_id',
          'hospital':'hospital_id','authorized_personnel':'authorized_personnel_id'}[owner_type]
    po = ProfileOwner.query.filter_by(tenant_id=tid, **{fk: actor.id}).first()
    if not po:
        po = ProfileOwner(tenant_id=tid, owner_type=owner_type, **{fk: actor.id})
        db.session.add(po); db.session.flush()
    return po
```
- Writers: `ProfileSignature(doctor_id=doctor.id, …)` → `ProfileSignature(profile_owner_id=get_or_create_profile_owner(doctor,'doctor').id, …)`.
- Readers: `doctor.signatures` → `doctor.profile_owner.signatures` (or add a convenience property). **Grep to find them all:** `filter_by(doctor_id=` / `admin_id=` on these six models, `.entity_type`, `.entity_id`.
- `entity_type`/`entity_id` computed props: repoint to `profile_owner.owner_type` / the resolved actor id, or update the consumers (`field_approval/service.py`, admin doc-view, etc.).

### Phase D — contract

`ALTER … SET NOT NULL` on `profile_owner_id` (six tables); drop `doctor_id`/`admin_id`/`authorized_personnel_id` + their `ck_*_exactly_one_owner` + old per-owner UNIQUEs; add `UNIQUE (tenant_id, profile_owner_id)` [+ `config_id` for declarations/documents, + `order_index` for bank]. The single CHECK now lives only on `profile_owner`.

## Files to touch

- **New:** `app/models/profile_owner.py` (or add to `app/models/profile_shared.py`) + `app/models/__init__.py` export.
- **Six models:** `app/models/profile_shared.py` — add `profile_owner_id` (A), drop old owner columns (D).
- **Actor models (relationship only, no column):** `app/models/doctor.py`, `admin.py`, `clinic.py`, `hospital.py`.
- **Writers/readers:** `app/api/service_provider/doctor/service.py`, `app/api/admin_profile_config/*`, `app/api/admin/routes.py` (doc-view ~1145), `app/api/field_approval/service.py`, and anything grep surfaces.
- **Migrations:** create+RLS (A), backfill (B), contract (D).

## Verify in the live app (per CLAUDE.md — drive the flow, don't just build)

- After **B:** doctor + admin profiles load/save byte-identical (regression) — sign in `doctorNN@platform-seed.test`, open Profile, confirm signature/about/education/bank read+write.
- After **C:** create a profile detail for a clinic/hospital owner and confirm it persists under a `profile_owner` row; confirm RLS still isolates by tenant.

## Gotchas / open follow-ups

1. **RLS:** `profile_owner` + the six tables need policies; the backfill runs as the RLS-bypassing migration role.
2. **`ON CONFLICT` needs the matching UNIQUE** — the `uq_profile_owner_tenant_*` constraints must exist before the backfill (they're in the create migration).
3. **Clinic/hospital have no profile UI/endpoints yet** — this makes storage support them; wiring their profile forms is a follow-up unless you want it now.
4. **`AdminProfileExtended`** (admin-only monolithic JSON, `admin.py:142`) partially duplicates this — leave, or fold in later.
5. **`entity_profiles`** (clinic/hospital statutory) stays separate by scope.
