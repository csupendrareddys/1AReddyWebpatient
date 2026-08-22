# Profile-owner centralization — implementation log

Companion to [profile-owner-centralization.md](profile-owner-centralization.md) (the design/plan).
This records **what was actually done**, tested, and deferred.

## Goal

Centralize the six per-actor profile-detail sub-tables (`profile_signatures`,
`profile_about`, `profile_education`, `profile_bank_accounts`,
`profile_declaration_responses`, `profile_documents`) onto a single
`profile_owner` table so all four actors (doctor / admin / clinic / hospital,
plus authorized-personnel) can own the same profile data — without dropping the
legacy `doctor_id` / `admin_id` / `authorized_personnel_id` owner columns.

## Migrations added (chain off `d04dfd753240`)

| Revision | Phase | What it does | Applied to dev DB |
|---|---|---|---|
| `a52b139f7fb0` | A | Create `profile_owner` (5 nullable actor FKs + exactly-one CHECK + RLS); add **nullable** `profile_owner_id` FK to all six sub-tables | ✅ |
| `a3b72202636b` | B | Backfill: one `profile_owner` row per existing doctor/admin/clinic/hospital/authorized-personnel; link every existing sub-row (idempotent, `ON CONFLICT`) | ✅ |
| `be1adf4e1a11` | D-core | Re-backfill safety pass → `profile_owner_id NOT NULL` on all six → drop the six `ck_*_exactly_one_owner` CHECKs (so clinic/hospital, which set neither doctor_id nor admin_id, can own rows) → add owner-based uniqueness | ✅ |
| `06cc45ffb9bf` | — | **Merge migration** unifying my head with `origin/main`'s pricing head (`9f9ee8ce7e5d`) after the rebase — no schema change | ❌ (not applied) |

## Code changes (all on branch `Anish-Work`, uncommitted)

- **`app/models/profile_shared.py`** — new `ProfileOwner` model (owner_type + 5 nullable actor FKs + exactly-one CHECK + per-owner uniques + relationships to the six sub-tables); added `profile_owner_id` (NOT NULL) + `profile_owner` relationship to each of the six sub-models.
- **`app/models/doctor.py` / `admin.py` / `clinic.py` / `hospital.py`** — added a reverse `profile_owner` relationship (no columns changed on the actor tables).
- **`app/models/_base.py`** — new `get_or_create_profile_owner(owner_type, owner_id, tenant_id)` helper.
- **`app/models/__init__.py`** — export `ProfileOwner` + the helper.
- **Writers dual-write** (`profile_owner_id` set alongside the legacy FK): 6 sites in `app/api/service_provider/doctor/service.py` and 6 in `app/api/admin_profile_config/routes.py`, via the helper.

## Deferred (intentionally — see plan §"cleanup" scope)

- **Reader cutover:** ~50 read sites across 9 files still filter by `doctor_id` / `admin_id` on the six sub-tables. They keep working because those legacy columns are still present and dual-written.
- **Physical column drop:** `doctor_id` / `admin_id` / `authorized_personnel_id` on the six sub-tables were **kept** (dual-written back-compat). Dropping them requires the ~50 reader rewrites first.

## Testing performed (all green)

- **Schema:** `profile_owner` shape, RLS forced + 2 policies, `profile_owner_id` on all six, CHECKs dropped, owner uniques present.
- **Backfill:** owner-row counts match actor counts exactly (doctor 22 / admin 6 / clinic 3 / hospital 1); **0 unlinked** sub-rows; backfilled links match the legacy FKs.
- **Capability:** a clinic **and** a hospital successfully own a `profile_bank_accounts` row with `doctor_id`/`admin_id` both NULL — impossible before D-core.
- **Endpoint sweep:** 216 parameterless GET routes via `test_client` — **no new server errors** from these changes.
- **Live write:** doctor education `POST /api/doctor/profile/education → 200`, row saved with `profile_owner_id` populated (verified in DB and via the real browser UI).

## Deploy-ordering hazard (hit + fixed locally; critical for prod)

`be1adf4e1a11` makes `profile_owner_id NOT NULL`. If the **old** application code (no dual-write) is still running when it applies, every profile write 500s. **Deploy the new code first, then migrate** (or split: apply up to `a3b72202636b` pre-swap, swap code, then apply `be1adf4e1a11`). Also: the cross-tenant backfill needs a `BYPASSRLS`/superuser migration role; `gen_random_uuid()` needs PostgreSQL 13+.

## Pre-existing bugs found (NOT caused by this work)

- `GET /api/doctor/qualifications` → 500 (reads a nonexistent `doctor.degrees`).
- `GET /api/patient-profile-config/.../audit-logs` → 500 (`ConfigAuditLog.created_at` missing).
- Doctor education form saves `graduation_data` as `{}` — frontend sends camelCase `graduation`, backend `save_education` reads snake_case `graduation_data` (field-name mismatch; belongs to the separate education-consolidation plan).

## Git

- Renamed `feature/tenant-addition` → `Anish-Work`.
- Rebased `Anish-Work` onto `origin/main` (which had advanced +16 commits) — **clean, zero conflicts**; profile-owner work restored via stash-pop, **uncommitted**.
- Rebase forked the Alembic DAG into 2 heads (`be1adf4e1a11` + main's `9f9ee8ce7e5d`); unified with merge migration `06cc45ffb9bf` (not applied to the DB).

## Remaining / follow-ups

1. Reader cutover + physical drop of legacy owner columns (the ~50-site cleanup).
2. Apply migrations to dev DB (`flask db upgrade` — single head now) + restart backend to run the rebased+merged code.
3. Fix the pre-existing education `graduation_data` field-name mismatch (separate plan).
