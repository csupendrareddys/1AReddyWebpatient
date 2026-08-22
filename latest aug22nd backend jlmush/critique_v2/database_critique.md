# Database Critique v2

> Audit Date: 2026-04-14
> Scope: Schema design, normalization, indexing, query patterns, data integrity
> Status: Post-refactoring re-audit

---

## RESOLVED FROM v1

| v1 Issue | Status |
|----------|--------|
| Timezone-aware vs timezone-naive DateTime mixed | **FIXED** -- All 133 `db.DateTime` occurrences across 28 files now use `timezone=True`. Zero violations |
| 5135-line monolithic model.py | **FIXED** -- Split into 28 domain-driven files under `app/models/` (7120 lines, well-organized) |
| N+1 in Prescription.to_dict(include_doctor=True) | **NOT FIXED** -- Still present (see below) |
| No FK index on Prescription.appointment_id | **NOT ADDRESSED** -- Still no standalone index (covered by composite indexes in some query patterns) |
| JSON columns for structured data | **NOT ADDRESSED** -- `Admin.permissions` JSON removed (FIXED), but Doctor.availability_config, Doctor.slot_pricing, Patient.address_details, QuestionnaireBlock.question_ids still use JSON |
| Soft delete without partial indexes | **PARTIALLY FIXED** -- Partial indexes added (e.g., `ix_doctors_active WHERE is_deleted = FALSE`), but redundant `index=True` on `is_deleted` column still exists |
| Prescription.pdf_link compound format | **NOT ADDRESSED** -- Still stores `"bucket::key"` string |
| HealthRecord.record_type is String not Enum | **NOT ADDRESSED** -- Still `String(50)` |
| Enum casing inconsistencies | **FIXED** -- FIXME comments added on all cased values. Aliases for renamed classes (`Refernces -> References`, `Approval_Type -> ApprovalType`). Actual DB values require data migration |
| Enum OTHER1/OTHER2 placeholders | **FIXED** -- Removed from all 9 enums |
| Doctor model overloaded (~60 columns) | **PARTIALLY FIXED** -- first_name, last_name, middle_name, gender, dob, profile_image, about, signature_image removed (moved to User or dedicated tables). Still ~45 columns |
| 6 Doctor/Admin model pairs duplicated | **FIXED** -- Merged into 6 polymorphic Profile* models with dual nullable FKs (doctor_id + admin_id) and CHECK constraint |
| 3 FieldConfig models duplicated | **FIXED** -- Merged into single `PageFieldConfig` with `page_type` discriminator |
| No multi-tenant support | **FIXED** -- `Tenant` model created, `TenantMixin` (tenant_id FK) applied to all 72 models. Unique constraints widened to include tenant_id |
| AdminProfileExtended duplicates Doctor | **PARTIALLY FIXED** -- gender, dob, profile_image, about, signature_image removed. Remaining admin-specific fields kept |
| LoginPageConfig vs PageConfig overlap | **NOT ADDRESSED** -- Both still exist |

---

## REMAINING ISSUES

### HIGH

#### 1. N+1 Query Patterns in `to_dict()` Methods

**Where**: 6 models have lazy-loading relationship access inside `to_dict()` that causes N+1 queries when called in a loop:

| Model | File | Lazy Loads Inside `to_dict()` |
|-------|------|-------------------------------|
| `Prescription` | `prescription.py:151` | `self.medicines.all()`, `self.follow_up_time_slot`, `self.patient`, `self.doctor`, `doc.qualifications.all()`, `doc.specializations.all()`, `doc.signature_record`, plus `HealthRecord.query.filter_by()` |
| `Appointment` | `appointment.py:122` | `self.doctor.full_name` (loads doctor + user), `self.patient.full_name` (loads patient + user) |
| `Doctor` | `doctor.py:197` | `self.user` for name/gender/dob/profile_image |
| `Patient` | `patient.py:100` | `self.user` for name/gender/dob/profile_image |
| `PatientQuestionAnswer` | `clinical.py:150` | `self.question.question_text` |
| `DoctorSymptom` | `clinical.py:252` | `self.symptom.name`, `self.symptom.category` |

**Impact**: Listing 20 prescriptions with `include_doctor=True` fires ~80 queries instead of 3. Listing 50 appointments fires ~200 queries. This scales linearly with page size.

---

#### 2. Nine UniqueConstraints Missing `tenant_id`

**Where**: These constraints don't include `tenant_id`, allowing theoretical cross-tenant collisions:

| Model | Constraint | Columns |
|-------|-----------|---------|
| `AppointmentSymptom` | `uq_appointment_symptom` | `(appointment_id, symptom_id)` |
| `DoctorSymptom` | `uq_doctor_symptom` | `(doctor_id, symptom_id)` |
| `DoctorHospitalAffiliation` | `uq_doctor_hospital` | `(doctor_id, hospital_id)` |
| `RolePermission` | `uq_role_module` | `(role_id, module)` |
| `SubAdminRole` | `uq_admin_role` | `(admin_id, role_id)` |
| `TimeSlot` | `uq_timeslot_doctor_date_start` | `(doctor_id, date, start_time)` |
| `TimeSlotType` | `uq_slottype_slot_type` | `(time_slot_id, consultation_type)` |
| `AttendancePageConfig` | `uq_attendance_config_doctor_section` | `(doctor_id, section_key)` |
| `DoctorQualificationSpecialization` | `uq_doctor_specialization` | `(doctor_id, category_id)` |

**Impact**: With UUIDs as primary keys, cross-tenant collision is astronomically unlikely. But for strict multi-tenant isolation, all unique constraints should include `tenant_id` as a principle.

---

#### 3. Redundant `is_deleted` Boolean Indexes

**Where**: 9 models have `is_deleted = db.Column(db.Boolean, ..., index=True)` which creates a useless full B-tree index on a boolean column. Many of these models ALSO have a partial index (e.g., `ix_doctors_active WHERE is_deleted = FALSE`), making the column-level index doubly redundant.

The `SoftDeleteMixin` in `_base.py:39` sets `index=True` globally, so every model inheriting it gets the redundant index.

**Impact**: Wasted disk space and slower INSERT/UPDATE performance for zero query benefit. The partial indexes already handle the `WHERE is_deleted = FALSE` filtering.

**Fix**: Remove `index=True` from `SoftDeleteMixin.is_deleted` and from all inline `is_deleted` column definitions.

---

### MEDIUM

#### 4. AuditMixin Defined But Not Applied to Any Model

**Where**: `app/models/_base.py:64-75` defines `AuditMixin` with `created_by_id` and `updated_by_id`. It is exported from `app/models/__init__.py`. But zero models inherit from it.

**Impact**: The mixin exists as dead code. Healthcare compliance (HIPAA, NABH) requires knowing who created/modified patient records, prescriptions, and appointments. The mixin was created for this purpose but never wired into models.

---

#### 5. Three Indexes Still Missing `tenant_id` as Leading Column

| File | Index | Columns |
|------|-------|---------|
| `user.py:128` | `ix_users_status_role` | `(status, role)` |
| `scheduling.py:59` | `ix_timeslots_doctor_date` | `(doctor_id, date)` |
| `page_config.py:515` | `ix_page_field_config_config_page_section` | `(config_id, page_type, section)` |

**Impact**: Queries filtering by tenant first cannot use these indexes efficiently. The `timeslots` case has a second tenant-prefixed index (`ix_timeslots_tenant_doctor`), making the non-prefixed one potentially redundant.

---

#### 6. `HouseGroupRequest` Uses `db.func.now()` Instead of `utcnow`

**Where**: `app/models/house_group.py:90-91`

```python
created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now())
updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), onupdate=db.func.now())
```

Every other model uses `default=utcnow` (Python-side). This model uses `server_default=db.func.now()` (database-side). While PostgreSQL's `now()` is timezone-aware, it uses the DB server's timezone setting rather than explicit UTC. This is a consistency issue.

---

### LOW

#### 7. `Prescription.pdf_link` Still Stores `"bucket::key"`

Two data points (S3 bucket + S3 key) are concatenated into one string column with a `::` delimiter. Code must split on `::` to generate presigned URLs. Should be two separate columns.

---

#### 8. `HealthRecord.record_type` Still a String, Not an Enum

The column is `db.String(50)` with no constraint on valid values. Every other type/status column uses a PostgreSQL enum. Typos like `"labreport"` vs `"lab_report"` can coexist.

---

#### 9. `LoginPageConfig` and `PageConfig` Both Still Exist

`LoginPageConfig` appears to be v1 of the page configuration system. `PageConfig` is v2 with draft/preview/live workflow. Both tables exist, both have routes, and both are maintained. This is a migration that was never completed.

---

#### 10. `QuestionnaireBlock.question_ids` JSON Still Exists (Deprecated)

The column is marked `nullable=True` with a deprecation comment. The proper `QuestionnaireBlockQuestion` junction table exists alongside it. The JSON column should be dropped after data is migrated.
