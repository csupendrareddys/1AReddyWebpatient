# Centralized profile — target design & consolidation plan

Captures the decisions made for eliminating the old/duplicate profile tables and
storing queryable data as columns/tables instead of JSON.

## Principle

**One central profile per entity.** `profile_owner` is the hub (carries
`owner_type` + exactly one of `doctor_id`/`admin_id`/`clinic_id`/`hospital_id`/
`authorized_personnel_id`). All profile data hangs off `profile_owner`. **Queryable
data → real columns/tables; only genuinely free-form data stays JSON.** Fields
common to every entity live once (shared), not duplicated per entity type.

## Final target schema

### Hub
- **`profile_owner`** *(exists)* — `owner_type` + 5 entity FKs (exactly-one CHECK).

### Shared profile data (one row per owner)
- **`profile_extended`** *(NEW)* — the fields common to doctor/admin (today split
  between the `doctors` table inline and `admin_profiles_extended`):
  `aadhaar_number/attachment`, `pan_number/attachment`, `registration_number`,
  `experience_years`, `height`, `weight`, `category`, `religion`, `citizenship`,
  `consultation_fee`, and **JSON (kept):** `languages_known`, `slot_pricing`,
  `female_health_details`. Keyed by `profile_owner_id`.
- **`addresses`** *(exists)* — communication/permanent addresses become **rows**
  (`address_type`), replacing the `communication_address`/`permanent_address`
  **JSON** on `doctors` + `admin_profiles_extended`. Add a nullable
  `profile_owner_id` so clinics/hospitals (no 1:1 user) can own addresses too.

### The six profile sub-tables *(exist)*
`profile_signatures`, `profile_about`, `profile_bank_accounts`,
`profile_declaration_responses`, `profile_documents`, and:
- **`profile_education`** *(exists, normalize)* — keep the per-level structure +
  documents; pull the **queryable** bits out of the JSON into columns
  (`degree_category_id`, `year`) ; free-text (scores, registration_no) stays.
  Absorbs `doctor_qualification_degrees`.
- **`profile_education_specialization`** *(NEW)* — the queryable specialization:
  `profile_owner_id`/`doctor_id` + `category_id` FK + `qualification_level` +
  `is_primary`. Replaces `doctor_qualification_specializations` (JSON can't be
  JOIN-ed for search). Search / product-gating / service-groups read this.
- `profile_declaration_responses` also absorbs the `self_declaration_data` **JSON**.

## Old tables / columns removed

| Removed | Data goes to |
|---|---|
| **table** `doctor_qualification_specializations` | `profile_education_specialization` |
| **table** `doctor_qualification_degrees` | `profile_education` (degree columns + JSON) |
| **table** `admin_profiles_extended` | `profile_extended` (+ `addresses`, `profile_declaration_responses`) |
| **cols** `communication_address`, `permanent_address` (doctors, admin_ext) | `addresses` rows |
| **cols** `self_declaration_data` (doctors, admin_ext) | `profile_declaration_responses` |
| **cols** doctor inline profile fields (aadhaar/pan/height/weight/category/… /languages_known/slot_pricing/female_health_details) | `profile_extended` |
| **cols** `doctor_id`/`admin_id`/`authorized_personnel_id` on the 6 sub-tables | already replaced by `profile_owner_id` |

**Kept JSON (free-form, not queried):** `languages_known`, `slot_pricing`,
`female_health_details`. **Out of scope** (not profile): doctor scheduling JSON
(`availability_config`, `approved_*`, `slot_visibility_*`, `offered_consultation_types`,
`publish_status_by_type`, `admin_allowed_appointment_modes`), `hospitals.operating_hours/
facilities/images`, `entity_profiles.promoters`.

## Prod data-migration mapping (the copy script)

1. `doctor_qualification_specializations` → `profile_education_specialization` (1:1; `category_id`, `is_primary` carry over; owner via `profile_owner`).
2. `doctor_qualification_degrees` → `profile_education` (map flat degrees onto the level slots by best-effort / order; **lossy** if >4 or level unknown — log unmapped).
3. `admin_profiles_extended` scalar fields → `profile_extended`; its address JSON → `addresses`; its `self_declaration_data` → `profile_declaration_responses`.
4. `doctors` inline profile fields → `profile_extended`; its address JSON → `addresses`; its `self_declaration_data` → `profile_declaration_responses`.
5. Resolve any JSON `specialization`/`degree` **names → `categories` ids** (case-insensitive, per tenant, `category_type` filter); log unmatched.

## Is safe deletion + migration possible? — YES, with caveats

- **DB-safe:** confirmed **zero foreign keys point into** `doctor_qualification_degrees`, `doctor_qualification_specializations`, or `admin_profiles_extended` — dropping them breaks no constraints. Dependencies are code-level only.
- **Data is preservable** once the two NEW tables exist (`profile_extended`, `profile_education_specialization`) — those are the queryable homes the current centralized tables lacked.
- **Caveats / risk:**
  - **Blast radius is large** — moving the `doctors` inline profile fields into `profile_extended` touches many doctor readers/serializers across the app; and repointing specialization/degree off the legacy tables touches patient search, booking, product-gating, service-groups, prescriptions (~15 readers).
  - **Lossy** flat-degrees → 4 level-slots (log + manual review of overflow).
  - **Name→id** resolution for legacy JSON specializations may leave unmatched rows (log, don't auto-create).
  - **Deploy ordering** (as already learned): new code before the NOT-NULL/drop migrations; migration role needs `BYPASSRLS`; PG13+.

## Rollout (phased, each verified in the live app before commit)

1. Add `profile_extended` + `profile_education_specialization` + `addresses.profile_owner_id` (additive).
2. Backfill from the old tables/columns (idempotent) + the prod copy script.
3. Repoint all readers/writers to the new tables/columns.
4. Drop the 3 old tables + the migrated JSON columns + the legacy sub-table owner columns.

## Phase 1 status — IMPLEMENTED (additive core), verified

Migration `7fce2e4c15b0` (off head `06cc45ffb9bf`) + models in `profile_shared.py`:
- ✅ `profile_extended` (identity/professional common fields, incl. alternative_phone/email) + backfill from doctors + admin_profiles_extended.
- ✅ `profile_education_specialization` (queryable specialization) + 1:1 backfill from `doctor_qualification_specializations`.
- ✅ `profile_education` degree columns (4 levels × {degree_category_id, year}) + lossy ranked backfill from `doctor_qualification_degrees`, overflow logged to `profile_education_degree_backfill_overflow`.
- **Verified** by temp-applying off `be1adf4e1a11`: 22 `profile_extended` + 6 `profile_education_specialization` rows, RLS forced, clean downgrade. Reset to the head after.
- Designed + adversarially verified via a Workflow (caught the aadhar→aadhaar rename, nullability mismatches, and the enum blockers that scoped the addresses backfill out).

**Deferred (needs your decisions):**
- `addresses.profile_owner_id` + address-JSON backfill — blocked by the `addresstype` enum needing an autocommit `ADD VALUE` (case must be UPPERCASE to match the model's name-persistence), plus partial data loss (district/gps/proof have no columns).
- `self_declaration_data` → `profile_declaration_responses` — the JSON is just terms/policies booleans with no config linkage; verifier suggested owner-level columns instead of sentinel configs. **Design decision needed.**

**Blocker to apply into dev:** `flask db upgrade` traverses main's migration `9a2be5a4a60e` which does `DROP INDEX ix_admin_overrides_resource_id` (created by the never-applied `a1b2c3d4e5f6`) — a rebase/lineage divergence to reconcile before the rebased chain (incl. this) can run on the dev DB.
