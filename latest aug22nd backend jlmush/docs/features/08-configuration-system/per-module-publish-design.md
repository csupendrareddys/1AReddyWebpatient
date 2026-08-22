# Per-module Publish Lifecycle — Design Doc

**Status**: DRAFT — awaiting review before implementation
**Owner**: TBD
**Round**: 9

---

## Problem

Today, each "page-config" page type (`doctor_profile`, `doctor_signup`,
`patient_profile`, `admin_profile`, `patient_appointment`) has **one**
`PageConfig` row at any given lifecycle state (DRAFT, PREVIEW, LIVE,
ARCHIVED). The Save Draft / Promote to Preview / Publish buttons in the
editor act on the **entire page** — every field across every section,
all at once.

The admin sidebar already presents the editor as a **set of "Controls"**
(loosely, modules), but the publish action doesn't follow that grouping.
Editing one Control (e.g. Education) and clicking Publish ships every
other Control too, even ones the admin didn't intend to touch. This is
risky during iteration — an in-progress Bank Details rewrite gets shipped
when the admin only wanted to publish a small Education tweak.

The user-requested behavior: each Control should have its **own** draft
/ preview / live lifecycle. Saving / publishing one Control affects only
that Control's fields.

## Glossary

* **Section** — the `section` column on `PageFieldConfig`. Fine-grained
  (e.g., `education_graduation`, `education_post_graduation`,
  `personal_details`, `current_address`).
* **Module** — a logical group of sections surfaced as one "Controls"
  entry in the editor sidebar. New concept. Examples:
  * `education` ← {`education_graduation`, `education_post_graduation`,
    `education_super_speciality`, `education_other_certification`}
  * `personal_professional` ← {`personal_details`,
    `additional_personal_details`, `identity_documents`,
    `female_health_details`}
  * `signatures_verification` ← {`signatures`}
  * `about_me` ← {`about_me`}
  * `bank_details` ← {`bank_accounts`}
  * `declaration_documents` ← {`declarations`}
  * `current_address` ← {`current_address`, `permanent_address`}
* **Page settings** — page-level config (title, colors, branding, logo)
  that lives directly on `PageConfig`, not on field rows. Stays
  globally-published.

## Current shape

```
PageConfig                                PageFieldConfig
├ id (UUID, PK)                          ├ id
├ tenant_id                              ├ config_id ──FK──┐
├ page_type                              ├ tenant_id       │
├ version                                ├ section         │
├ status   (DRAFT|PREVIEW|LIVE|ARCHIVED) ├ field_key       │
├ page_title, primary_color, …           ├ field_type       (one PageConfig
└ published_at                           ├ label / placeholder / …    has many
                                          ├ options / data_source        rows)
                                          ├ display_order
                                          └ is_default / is_present
```

The lifecycle endpoints (`get_or_create_draft` / `promote_to_preview`
/ `publish` / `restore_version`) flip `PageConfig.status` on a single
row at a time and propagate everything underneath.

## Three approaches

### Approach A — `module_states` JSON column on PageConfig
Add `module_states: JSONB` to `PageConfig`:
```json
{
  "education":             {"status": "live",  "published_at": "...", "draft_dirty": false},
  "personal_professional": {"status": "draft", "published_at": "...", "draft_dirty": true},
  "signatures_verification": {"status": "preview", "published_at": "...", "draft_dirty": false}
}
```
Save and publish operate on a single module's slice within this JSON.

**Pros**: tiny migration (one JSONB column).
**Cons**: no versioning per module, no per-module history, no audit log
isolation. The PageConfig row itself still has a global `status` field
which becomes meaningless. Bolt-on, easy to corrupt.

### Approach B — One PageConfig row per (page_type, module)
Replace the single `(tenant_id, page_type, version, status)` row with
many `(tenant_id, page_type, module, version, status)` rows.

**Pros**: maximum isolation, clean per-module versioning + audit trail.
**Cons**: Massive blast radius — every endpoint that reads
`get_live_config()` becomes "for each module, get its live config".
Page-level settings (title, colors) need a special "module=`__page__`"
sentinel or a separate table. Migration of existing rows is non-trivial.

### Approach C — Sibling `ModuleConfig` table (recommended)

Keep `PageConfig` as the owner of **page-level settings** (one row per
`page_type` per tenant, as today). Introduce a new sibling table
`ModuleConfig` that owns the **lifecycle of a module's field rows**:

```
PageConfig                                    ModuleConfig
├ id (UUID, PK)                              ├ id (UUID, PK)
├ tenant_id                                  ├ tenant_id
├ page_type                                  ├ page_type
├ version  (page-level only)                 ├ module    (new — "education", "personal_professional", …)
├ status   (DRAFT|PREVIEW|LIVE|ARCHIVED)     ├ version
├ page_title, primary_color, …               ├ status   (DRAFT|PREVIEW|LIVE|ARCHIVED)
├ logo_asset_id, …                           ├ published_at
├ published_at                               ├ note     (publish note from Round 7)
└ note                                       └ unique on (tenant, page_type, module, version)

PageFieldConfig                              PageFieldConfig (post-migration)
├ id                                         ├ id
├ config_id ──FK→ PageConfig                 ├ module_config_id ──FK→ ModuleConfig
├ tenant_id                                  ├ tenant_id
├ section                                    ├ section
├ field_key                                  ├ field_key
├ … rest unchanged                           ├ … rest unchanged
```

`PageFieldConfig` switches from `config_id → PageConfig` to
`module_config_id → ModuleConfig`. The `module` a field belongs to is
derived from its `section` via a constants map (and stored on
`ModuleConfig`).

The full live page is reconstructed as **PageConfig (page-level settings)
+ N LIVE ModuleConfigs (one per module)**. The public read endpoint
loops over the modules + unions their field rows.

**Pros**:
- Clean separation: page-level settings vs per-module field lifecycles.
- Each module gets its own version, history, audit log, publish note.
- The migration is mechanical (every existing PageConfig's fields are
  partitioned by section → module → new ModuleConfig rows).
- Frontend reuses the existing ConfigEditorHeader; mount one per
  module rendered in the sidebar.

**Cons**:
- Migration is non-trivial (data move from PageConfig → many
  ModuleConfigs).
- Every backend service that touches `PageFieldConfig.config_id`
  needs an FK column rename.

## Recommended approach: C, in 4 phases

### Phase 1 — Scaffold ✅ this round
- Add `ModuleConfig` model + table.
- Add `PageFieldConfig.module_config_id` (nullable, FK to ModuleConfig).
  Old `config_id` stays for now — both columns coexist during the
  transition.
- Add a `SECTION_TO_MODULE` constants map per page_type.
- Backend changes are additive only; no endpoint behavior changes yet.

### Phase 2 — Backfill migration
- For each existing PageConfig, derive its set of modules from
  `PageFieldConfig.section` values.
- For each module, create a ModuleConfig row whose `status` mirrors the
  parent PageConfig's status (DRAFT → DRAFT, LIVE → LIVE, etc.).
- UPDATE each PageFieldConfig.module_config_id = matching ModuleConfig.id.
- Keep `PageFieldConfig.config_id` populated for one release (back-compat).

### Phase 3 — Backend endpoint cutover
- New endpoints:
  * `GET    /admin/<page_type>/draft?module=<m>`
  * `PUT    /admin/<page_type>/draft/<m>/fields`
  * `POST   /admin/<page_type>/<m>/preview`
  * `POST   /admin/<page_type>/<m>/publish` (with `note`)
  * `GET    /admin/<page_type>/<m>/history`
  * `POST   /admin/<page_type>/<m>/restore/<version_id>`
- Existing page-wide endpoints (`/draft`, `/publish`, `/history`) become
  thin wrappers that operate on **all** ModuleConfigs (kept for one
  release as back-compat).
- `get_merged_config` (public read) unions LIVE ModuleConfigs per
  page_type.

### Phase 4 — Frontend cutover + cleanup
- Per-module ConfigEditorHeader in each "Controls" entry.
- Per-module Live Preview tab — same component, different module
  selector.
- Per-module History tab.
- Delete `PageFieldConfig.config_id` once the deprecation window passes
  and confirm no callers remain.

## What stays unchanged

- **Page-level settings** (title, subtitle, logo, colors, primary_button_text,
  footer): still on PageConfig. Editing these still ships as one global
  publish from the "Page Settings" Control (which has its own
  `PageConfig.status` to track). This is fine — page-level concerns
  shouldn't change often.
- **Master Data**: not part of PageConfig at all today. Each
  MasterCollege / Category row is independently editable. The Master
  Data Module continues to be its own surface, no per-version lifecycle
  needed.
- **Field defaults** (`default_fields.py`): unchanged. Module derivation
  from section happens at seed time + on every `get_or_create_draft`.
- **Restore from version**: now per-module. Restoring an Education
  version doesn't roll back Bank Details.

## Sibling editors affected

The same shape applies to all five page_types:
1. `doctor_profile`        — biggest impact (≈12 modules)
2. `doctor_signup`         — ≈5 modules (personal, identity, qualifications, plan, branding)
3. `patient_profile`       — ≈6 modules
4. `admin_profile`         — ≈4 modules
5. `patient_appointment`   — ≈3 modules

Rolling out Phase 2 + Phase 3 module-by-module per editor is the safest
sequence (start with `doctor_profile` since the user reported it; verify
end-to-end; then propagate to siblings).

## Risks

| Risk | Mitigation |
|---|---|
| Migration data loss on a busy production tenant | Two-write window — keep `config_id` populated alongside `module_config_id` so reads can fall back to the old path during cutover. Backfill is idempotent. |
| Public read endpoint serves a half-migrated config | `get_merged_config` first tries the new per-module read; falls back to the old per-PageConfig read if no ModuleConfig rows exist yet. |
| Operator confusion — many publish buttons | Each Control gets its own ConfigEditorHeader; sidebar shows a green "Live" chip when that module is published, "Draft" otherwise. Same chip semantics as today, just per-module. |
| Audit-log volume balloons | One PUBLISH row per module per publish action. With ≈12 modules and infrequent publishes, this is fine (still smaller than per-field events). |

## Out-of-scope (for now)

- Per-section lifecycle (more granular than module).
- Field-level approval flow per module (the existing field-approval
  system can layer on top, no change needed for it).
- Translations versioning per module (still page-wide).

## Open questions for review

1. **Module definitions** — is the `SECTION_TO_MODULE` map I sketched
   above the right grouping? Specifically: should `current_address` +
   `permanent_address` be one module ("Addresses") or part of
   "Personal & Professional"?
2. **Should Master Data and Page Settings show up as Controls** in the
   sidebar at all once per-module landing is done? They have different
   lifecycle semantics — Master Data is row-level, Page Settings is a
   single PageConfig.
3. **Back-compat window** — how long do we keep the legacy
   page-wide endpoints alive? Suggest: one release cycle (≈2 weeks).
4. **Migration safety** — should the backfill run as part of `flask db
   upgrade`, or as a separate `flask seed-module-configs` command the
   operator triggers explicitly? I lean toward Alembic migration so it
   runs automatically on deploy.

Once these answers settle, I'll start Phase 1 (model + scaffold) in the
next session.
