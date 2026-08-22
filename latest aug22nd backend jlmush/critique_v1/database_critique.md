# Database Critique

> Audit Date: 2026-04-13
> Scope: Schema design, normalization, indexing, query patterns, data integrity

---

## CRITICAL

### 1. Timezone-Aware vs Timezone-Naive DateTime Columns Mixed Across Models

**Where**: `model.py` -- `User` and `UserSession` use `db.DateTime(timezone=True)` (lines 354-365, 562-569). Every other model uses bare `db.DateTime` (Doctor line 756-757, Patient line 891-892, Admin line 1034-1036, Appointment, Payment, etc.).

PostgreSQL stores `TIMESTAMP WITHOUT TIME ZONE` for bare `db.DateTime` and `TIMESTAMP WITH TIME ZONE` for `db.DateTime(timezone=True)`. The `utcnow()` function returns a timezone-aware datetime (`datetime.now(timezone.utc)`).

**Impact**: When a timezone-aware datetime from Python is inserted into a `TIMESTAMP WITHOUT TIME ZONE` column, PostgreSQL silently strips the timezone info. When read back, the datetime is naive (no tzinfo). Comparing this naive datetime with `utcnow()` (which IS timezone-aware) raises `TypeError: can't compare offset-naive and offset-aware datetimes` in Python.

The `UserSession.is_expired()` method (model.py lines 586-598) has a defensive workaround: it manually patches `tzinfo` onto naive datetimes. This workaround is needed precisely because the columns use mixed timezone strategies. Other models lack this workaround, meaning any timezone comparison will either fail silently or crash at runtime.

---

### 2. 5135-Line Monolithic Model File With No Domain Separation

**Where**: `model.py` (root level, outside `app/` package). Contains 68+ model classes, 30+ enums, utility functions, and event listeners in a single file. `app/models/` directory exists but is empty.

**Impact**:
- **Alembic migrations** scan the entire file on every `flask db migrate`. With 68 models, autogenerate is slow and produces massive migration files.
- **IDE indexing and autocomplete** degrade -- most editors struggle with 5000+ line Python files.
- **Merge conflicts**: Two developers adding unrelated models (e.g., one adds a marketplace model, another adds a config model) will conflict because both edit the same file.
- **Import cost**: `from model import User` loads and parses all 5135 lines, all 68 model classes, all 30+ enums, and all utility functions -- even if the caller only needs `User`.

---

### 3. N+1 Query Patterns in `to_dict()` Methods

**Where**: `Prescription.to_dict(include_doctor=True)` (model.py lines 2258-2325) accesses `doc.qualifications.all()`, `doc.specializations.all()`, and `doc.signature_record` -- 3+ lazy-loaded relationships per prescription.

Almost all relationships are defined with `lazy='dynamic'`, which returns a query object. When `to_dict()` is called in a loop (e.g., listing prescriptions), each iteration fires separate SQL queries for each relationship.

Example: Listing 20 prescriptions with `include_doctor=True` fires:
- 1 query for prescriptions
- 20 queries for doctor records
- 20 queries for qualifications
- 20 queries for specializations
- 20 queries for signature records
= **81 queries** instead of 2-3 with eager loading.

**Impact**: Response times scale linearly with result count. A page of 50 items could fire 200+ queries. Database connection pool exhaustion under moderate load.

---

### 4. No Foreign Key Index on High-Cardinality Relationships

**Where**: Several foreign key columns lack explicit indexes:

- `Appointment.patient_id` -- While composite indexes exist on `(patient_id, appointment_date)`, queries filtering by `patient_id` alone (e.g., `GET /api/patient/appointments`) may not use the composite index efficiently depending on query shape.
- `Prescription.appointment_id` -- No index. Every `Prescription.query.filter_by(appointment_id=...)` is a sequential scan as the table grows.
- `Payment.appointment_id` -- No index. `GET /api/payment/appointment/<id>` scans the payments table.
- `FollowUpInvite.appointment_id` -- No index.
- `AppointmentMedicalContext.appointment_id` -- No index.
- `HouseGroupMember.owner_patient_id` -- No index. Listing house group members requires scanning.
- `FieldApprovalRequest` has composite index on `(entity_type, entity_id)` but no standalone index on `submitted_by_id` for `GET /api/field-approval/my-requests`.

**Impact**: As tables grow past 10K-100K rows, queries on these unindexed foreign keys degrade from milliseconds to seconds. The appointment ecosystem (prescriptions, payments, medical contexts, follow-ups) is especially vulnerable since these tables grow with every consultation.

---

## HIGH

### 5. JSON Columns Used for Structured, Queryable Data

**Where**: Multiple models store structured data as JSON that is later queried or filtered:

- `Doctor.availability_config` (JSON) -- Contains scheduling rules, queried during slot generation
- `Doctor.slot_pricing` (JSON) -- Contains per-consultation-type pricing, read on every booking
- `Doctor.slot_visibility_gap` (JSON) -- Configuration per consultation type
- `Patient.address_details` (JSON), `female_health_details` (JSON), `organization_details` (JSON)
- `Admin.permissions` (JSON) -- Legacy permission list, still used in fallback auth path
- `LoginFieldConfig` (JSON for `translations`, `options`, `validation`)
- `DoctorQuestion.options` (JSON), `validation_rules` (JSON)
- `QuestionnaireBlock.question_ids` (JSON array)
- `RolePermission.field_restrictions` (JSON)

**Impact**: JSON columns cannot be indexed by PostgreSQL B-tree indexes (GIN indexes are possible but not created). Filtering, sorting, or joining on JSON field values requires `->>`  operators or `func.json_extract`, which bypass the query planner's cost estimation. As data grows, queries that filter on JSON fields become full table scans. The `Admin.permissions` JSON list is a critical example -- it's checked in the authorization fallback path, meaning every sub-admin request to an unmapped permission does a JSON array contains-check at the application level.

---

### 6. Soft Delete Without Partial Indexes

**Where**: Every major model has `is_deleted = db.Column(db.Boolean, default=False, index=True)` and `deleted_at`.

The `index=True` on `is_deleted` creates a standard B-tree index, but since the vast majority of rows have `is_deleted=False`, this index is nearly useless -- the selectivity is too low. Every query adds `.filter(is_deleted=False)` but the index doesn't help discriminate.

**Impact**: The index on `is_deleted` wastes disk space and slows INSERT/UPDATE operations (index maintenance) while providing almost no query benefit. A partial index `WHERE is_deleted = FALSE` on frequently-queried columns would be vastly more efficient. As the `is_deleted=True` population grows (over years of soft deletes), query performance degrades because the planner cannot efficiently skip deleted rows.

---

### 7. `Prescription.pdf_link` Stores Compound Data as a String

**Where**: `model.py` Prescription model -- `pdf_link` column stores `"bucket::key"` format. The service code splits this on `::` to generate presigned URLs.

**Impact**: This embeds two separate data points (bucket name and S3 object key) in a single string column with a custom delimiter. If the S3 key ever contains `::`, the parsing breaks. There's no database-level validation of the format. A migration to a different storage provider requires parsing every `pdf_link` value. Two separate columns (`pdf_s3_bucket`, `pdf_s3_key`) would eliminate the parsing logic entirely.

---

### 8. `HealthRecord.record_type` Is a String, Not an Enum

**Where**: `model.py` HealthRecord model -- `record_type = db.Column(db.String(50))`.

All other type/status columns in the codebase use PostgreSQL enums (`db.Enum(EnumClass)`). HealthRecord breaks this pattern with a raw string.

**Impact**: No database-level constraint on valid values. Typos like `"labreport"` vs `"lab_report"` vs `"Lab Report"` can coexist in the same column. Querying by type requires case-insensitive matching or data cleanup. The lack of an enum means the set of valid record types is defined nowhere in the codebase.

---

### 9. Enum Values Have Inconsistent Casing and Placeholder Slots

**Where**: `model.py` enums:

- `UserVerificationStatus`: `PENDING = 'pending'`, `QUERY = 'Query'` (capitalized!), `VERIFIED = 'verified'`, `OTHER1 = 'other1'`, `OTHER2 = 'other2'`
- `Approval_Type`: `QUERY = 'Query'`, `TEMPORARILY_APPROVED = 'temporarly approved'` (typo + space)
- `Refernces` (typo in class name): `FAMILY = 'family'`, `OTHER1 = 'other1'`
- Almost every enum has `OTHER1` and `OTHER2` placeholder values

**Impact**: The mixed casing (`'Query'` vs `'query'`, `'Hold'` vs `'hold'`) means PostgreSQL enum comparisons are case-sensitive -- a query for `status = 'query'` will NOT match `'Query'`. The `Approval_Type.TEMPORARILY_APPROVED = 'temporarly approved'` has a typo ("temporarly") and a space, which is now permanently in the database since changing enum values requires a migration. The `OTHER1`/`OTHER2` placeholders on nearly every enum suggest a design decision to pre-allocate enum values, but they waste database storage and make the domain model unclear.

---

## MEDIUM

### 10. No Database-Level Cascade Deletes

**Where**: Relationships in `model.py` use SQLAlchemy's `cascade='all, delete-orphan'` or no cascade at all. No `ON DELETE CASCADE` or `ON DELETE SET NULL` is specified at the database level.

Example: `User` has relationships to `Doctor`, `Patient`, `Admin`, `UserSession`. If a user row is deleted via raw SQL or a migration script (bypassing SQLAlchemy), orphaned rows remain in all related tables.

**Impact**: Data integrity depends entirely on the application layer (SQLAlchemy ORM). Direct database operations (migrations, manual fixes, admin scripts) can create orphaned records. The soft-delete pattern mitigates this for normal operations, but hard deletes (which exist: `super_admin/routes.py` supports `?hard=true`) bypass cascades.

---

### 11. Doctor Model Is Overloaded (~60 Columns)

**Where**: `model.py` Doctor model has columns for: personal info (name, gender, DOB, aadhaar), professional info (registration_number, council, year), availability config (JSON), approval status, slot pricing (JSON), publish status, visibility config (JSON), consultation types, extended profile flags, and more.

**Impact**: Every query that touches the Doctor model loads all ~60 columns into memory, even when only a few are needed. The `to_dict()` method (which serializes the entire model) is called frequently for listing endpoints. Columns like `availability_config` (JSON blob), `slot_pricing` (JSON blob), and `extended_profile` (JSON blob) can be kilobytes each, multiplied by page size.

---

### 12. Optimistic Locking Used in Only One Place

**Where**: `Rbac.py` `ApprovalRequest.approve_level()` (lines 825-843) uses a version column with raw SQL for atomic updates. No other model uses optimistic or pessimistic locking.

**Impact**: The Appointment model, which has complex state transitions (PENDING_PAYMENT -> CONFIRMED -> IN_PROGRESS -> COMPLETED) and is modified by multiple actors (patient, doctor, admin, payment webhook, expiry job), has no concurrency control. Two concurrent requests (e.g., patient cancels while doctor completes) can race, with the last commit winning. The `DoctorPayout` model also has concurrent modification risks (admin initiates while bulk-initiate job runs).

---

### 13. No Check Constraints on Most Status Transitions

**Where**: `AppointmentStatus`, `PaymentStatus`, `PrescriptionStatus` enums define valid states, but PostgreSQL only enforces that the value is a valid enum member -- not that the transition is valid.

**Impact**: Nothing at the database level prevents an appointment from going from `COMPLETED` to `PENDING_PAYMENT`, or a payment from going from `SUCCESS` to `CREATED`. Invalid state transitions can only be caught by application code (service layer), which is not consistently present across all routes.

---

## LOW

### 14. `utcnow()` Returns Timezone-Aware But Column Default Does Not Match

**Where**: `model.py:14` defines `utcnow()` returning `datetime.now(timezone.utc)`. Used as `default=utcnow` on all timestamp columns. But as noted in issue #1, most columns use `db.DateTime` (naive) not `db.DateTime(timezone=True)`.

**Impact**: PostgreSQL silently strips the timezone on insert into `TIMESTAMP WITHOUT TIME ZONE` columns. The `utcnow()` function's timezone-awareness is wasted on most columns.

---

### 15. `app/models/` Directory Exists But Is Empty

**Where**: `app/models/` contains no files. All models live in root `model.py`.

**Impact**: Misleading directory structure. A developer looking for models would check `app/models/` first, find nothing, and then discover the root-level `model.py` through grep.
