# API Endpoints Critique v2

> Audit Date: 2026-04-14
> Scope: REST design, naming, request/response, error handling, auth/authz gaps
> Status: Post-refactoring re-audit

---

## RESOLVED FROM v1

| v1 Issue | Status |
|----------|--------|
| No rate limiting outside auth | **FIXED** -- Global 100/min limit applied to entire `api_bp` blueprint via `limiter.limit("100/minute")(api_bp)` |
| Dead test endpoint (`create_doctor_test`) | **FIXED** -- Entire route deleted from `super_admin/routes.py` |
| Exception messages leaked to clients (status_code=500) | **FIXED** -- 36 instances sanitized across `admin/routes.py`, `rbac/routes.py`, `video/routes.py`, `doctor/routes.py`. All 500 responses now return `'An internal error occurred'` |
| `force_logout_all` Aadhaar lookup broken | **FIXED** -- Implemented `Doctor.query.filter_by(aadhar_number=identifier)` lookup with user resolution |
| File uploads accept any type | **FIXED** -- Extension validation added in `s3_service.py:upload_file()` against `ALLOWED_EXTENSIONS` config |
| Trailing slash inconsistency | **FIXED** -- `appointment_bp.route('/')` changed to `route('')` |
| Video routes camelCase bodies | **FIXED** -- `roomName`/`appointmentId` changed to `room_name`/`appointment_id` |
| Admin stubs return 200 | **FIXED** -- All 6 stubs now return `501 Not Implemented` with `{success: false, error: 'Not implemented'}` |
| `UpdateProfileSchema` dead code | **NOT ADDRESSED** -- Still exists in `auth/validators.py`. Low priority |

---

## REMAINING ISSUES

### HIGH

#### 1. Exception Messages Still Leaked in 4 Route Files

**Where**: 15 instances across these files where `str(e)` is sent in 500 responses:

| File | Count | Example |
|------|-------|---------|
| `app/api/config/routes.py` | 10 | `error_response(f'Error retrieving config: {str(e)}', 500)` |
| `app/api/page_config/routes.py` | 3 | `error_response(f"Upload failed: {str(e)}", 500)` |
| `app/api/admin_profile_config/routes.py` | 1 | `error_response(f"Failed to load config: {str(e)}", 500)` |
| `app/api/field_approval/routes.py` | 1 | `jsonify({'error': '...', 'detail': str(e)}), 500` |

The `field_approval` case is the worst -- it explicitly names the field `'detail': str(e)`, sending raw exception text as a structured response field.

**Impact**: Database column names, constraint names, and SQLAlchemy internals can be exposed to clients through these paths.

---

#### 2. Inconsistent Response Structure: `field_approval/routes.py`

**Where**: `app/api/field_approval/routes.py` -- ALL endpoints use raw `jsonify({...})` instead of the standard `success_response`/`error_response` helpers.

Every other major blueprint (admin, RBAC, billing, medicine_catalog, payout, patient, doctor, appointment, payment) uses the response helpers from `app/common/responses.py`. Field approval is the sole holdout.

**Impact**: Frontend must handle a different response shape for field approval endpoints. No `success` field in responses. Error format differs (`{'error': '...'}` vs `{'success': false, 'error': '...'}`).

---

#### 3. No `max_per_page` on Admin List Endpoints

**Where**: These endpoints accept `per_page` from query params with no upper bound:

| Endpoint | File |
|----------|------|
| `GET /api/admin/patients` | `admin/routes.py:31` |
| `GET /api/admin/appointments` | `admin/routes.py:148` |
| `GET /api/admin/doctors` | `admin/routes.py:202` |
| `GET /api/admin/doctors/pending` | `admin/routes.py:440` |
| `GET /api/admin/rbac/roles` | `rbac/routes.py:37` |
| `GET /api/admin/rbac/sub-admins` | `rbac/routes.py:248` |
| `GET /api/admin/rbac/audit-logs` | `rbac/routes.py:391` |
| `GET /api/admin/rbac/approvals` | `rbac/routes.py:479` |

A client can request `?per_page=999999` and pull the entire table in one query.

**Impact**: Memory exhaustion on the server. Slow queries that block the connection pool. Potential denial-of-service.

---

### MEDIUM

#### 4. No Schema-Based Input Validation Outside Auth/SuperAdmin

**Where**: Only 2 modules use Marshmallow schemas:
- `app/auth/validators.py` (auth routes)
- `app/api/admin/super_admin/validators.py` (super admin routes)
- `app/api/admin/rbac/validators.py` (RBAC routes)

All other modules use manual inline `if not data.get('field')` checks. This includes critical endpoints like appointment booking (30+ lines of inline validation), medicine catalog CRUD, billing config updates, and field approval submissions.

**Impact**: No schema documentation for API consumers. Type coercion errors surface as 500s instead of 422s. Missing fields may cause KeyError crashes instead of validation responses.

---

#### 5. Missing Error Handling in Appointment Routes

**Where**: `app/api/common/appointment/routes.py`

Most endpoints only catch `ValueError` or `PermissionError`. There is no generic `except Exception` handler and no `db.session.rollback()` call anywhere in the file.

**Impact**: If a database error occurs during booking (e.g., unique constraint violation, connection timeout), the exception bubbles to the global 500 handler. The database session may be left in a dirty state for the current request. Flask-SQLAlchemy auto-rollbacks on teardown, but any partial commits before the error are not explicitly rolled back.

---

#### 6. Inconsistent `db.session.rollback()` in RBAC Routes

**Where**: `app/api/admin/rbac/routes.py`

`clone_role` (line 134) calls `db.session.rollback()` on exception. But `create_role` (line 62), `update_role` (line 92), `delete_role` (line 109), and most other RBAC endpoints do NOT rollback in their exception handlers.

**Impact**: Inconsistent cleanup on failure. If the service layer partially committed before an error, the session is left dirty.

---

### LOW

#### 7. POST Used for Read Operations (Unchanged from v1)

`POST /auth/active-sessions`, `POST /auth/force-logout-session`, `POST /auth/force-logout-all` are semantically reads that require credentials in the body. While defensible for security, they break REST semantics. Low priority -- changing would be a breaking API change.

---

#### 8. Appointment State Transitions Still Duplicated

`POST /api/appointment/<id>/complete` and `POST /api/doctor/appointments/<id>/complete` are separate endpoints that may have divergent business logic. Same for accept/reject. This was noted in v1 and remains unchanged. Requires API design review.

---

#### 9. Public Doctor Endpoints Have No Pagination Cap

`GET /api/doctor/list`, `GET /api/doctor/search` are public (no auth). They have the global 100/min rate limit but no `max_per_page` enforcement. A scraper could paginate through all doctors at 100 requests/min.

**Impact**: Low -- rate limiting mitigates the worst case. But a dedicated scraper could still extract the full doctor directory over time.
