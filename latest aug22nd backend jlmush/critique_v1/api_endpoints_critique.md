# API Endpoints Critique

> Audit Date: 2026-04-13
> Scope: REST design, naming, request/response, error handling, auth/authz gaps

---

## CRITICAL

### 1. No Rate Limiting on Any API Endpoint Outside Auth

**Where**: Auth routes have explicit `@limiter.limit()` decorators (signup 3/min, signin 5/min, etc.). No other blueprint applies rate limiting. The global default `RATELIMIT_DEFAULT = '100 per minute'` is configured in `config.py:52` but flask-limiter's default only applies when `limiter.init_app()` is called -- and the limiter is only triggered on routes that explicitly use it or when a default is inherited.

**Impact**: An attacker can:
- Enumerate all doctors via `GET /api/patient/doctors` at unlimited speed
- Brute-force appointment booking to reserve all slots
- Scrape the entire medicine catalog via `GET /api/admin/medicine-catalog/medicines`
- Flood `POST /api/appointment/` to exhaust slot inventory
- Spam `POST /api/field-approval/submit` to create thousands of approval requests

Without per-endpoint rate limiting, any authenticated user can perform denial-of-service against business-critical flows.

---

### 2. Dead Test Endpoint in Production

**Where**: `app/api/admin/super_admin/routes.py:84-145` -- `POST /api/admin/super-admin/doctor_test`

This endpoint:
- Has `print("my world")` as its only logic
- Has all business logic commented out
- Returns `None` implicitly (Flask converts this to a 500 error)
- Is protected only by `@role_required(UserRole.SUPER_ADMIN)`, meaning any super admin hitting it gets a 500

**Impact**: A 500 error in production from a test endpoint. If error monitoring existed, this would create noise. Its docstring is copied from `create_admin`, misleading anyone reading the code.

---

### 3. Exception Messages Leaked to Clients

**Where**: Multiple routes across the codebase pass `str(e)` directly into API responses.

Examples:
- `app/api/admin/routes.py:133`: `f'Failed to update status: {str(e)}'` with status 500
- `app/api/admin/routes.py:246`: `f'Failed to update verification: {str(e)}'`
- `app/api/admin/routes.py:308`: `f'Failed to update status: {str(e)}'`
- `app/api/common/appointment/routes.py` catches `ValueError` and returns `str(e)` at 400
- `app/auth/route.py:357` catches bare `Exception` and checks message string content

**Impact**: Database errors (including table names, column names, constraint names), SQLAlchemy internals, and Python tracebacks can be exposed to clients. An attacker can use these messages to map the database schema, understand ORM relationships, and craft targeted injection attempts.

---

### 4. `force_logout_all` Silently Fails for Aadhaar Lookup

**Where**: `app/auth/route.py:491` -- The `POST /auth/force-logout-all` endpoint handles email, phone, and aadhaar login identifiers. The aadhaar branch sets `user = None`, meaning the endpoint returns a generic "Invalid credentials" for any aadhaar-based logout attempt.

```python
else:
    user = None  # Aadhaar path silently produces None
```

**Impact**: Users who signed up via Aadhaar cannot force-logout their sessions from all devices. This is a security feature gap -- if their session is compromised, they have no way to revoke it without contacting support.

---

## HIGH

### 5. Inconsistent Response Structure Across Blueprints

**Where**: Three different response patterns coexist.

**Pattern A -- Response helpers** (auth, patient, doctor, appointment):
```json
{"success": true, "message": "...", "data": {...}}
{"success": false, "error": "..."}
```

**Pattern B -- Raw jsonify** (field_approval, super_admin, legal):
```json
{"request_id": "...", "status": "pending"}
{"message": "Role created", "role": {...}}
{"title": "Terms", "content": "..."}
```

**Pattern C -- Global error handlers** (`app/common/__init__.py:214-245`):
```json
{"error": "Bad Request", "message": "..."}
```

Pattern A includes `success: true/false`. Pattern B omits it entirely. Pattern C uses `error` as the key name but not `success`. JWT error callbacks add a `code` field (`token_expired`, `invalid_token`) that nothing else uses.

**Impact**: Frontend must handle three different response shapes. Error detection logic (`if (!response.success)` vs `if (response.error)`) differs per endpoint. This is a contract violation -- the API has no single, predictable envelope.

---

### 6. No Input Validation Outside Auth Module

**Where**: Marshmallow schemas exist in `app/auth/validators.py`, `app/api/admin/super_admin/validators.py`, and `app/api/admin/rbac/validators.py`. No other module uses schema-based validation.

Specific gaps:
- `POST /api/appointment/` (booking) -- 30+ lines of inline `if not data.get('field')` checks, no schema
- `PUT /api/patient/profile` -- passes raw JSON to service with only a null check
- `POST /api/admin/medicine-catalog/medicines` -- manual field extraction, no type validation
- `PUT /api/admin/billing-config` -- accepts JSON directly, validates inline
- `POST /api/field-approval/submit` -- complex nested payload validated manually

**Impact**: Type coercion errors (string where int expected), missing field errors, and constraint violations surface as database errors (500) instead of validation errors (422). The lack of schema documentation means the API is self-documenting only via reading route code.

---

### 7. POST Used for Read Operations

**Where**:
- `POST /auth/active-sessions` -- Lists active sessions (requires credentials in body)
- `POST /auth/force-logout-session` -- Reads session then acts on it
- `POST /auth/force-logout-all` -- Reads user by credentials then acts

While putting credentials in a POST body (instead of URL) is defensible for security, the semantic mismatch means:

**Impact**: These endpoints cannot be cached by HTTP intermediaries. API documentation tools (Swagger/OpenAPI) will categorize them as write operations. Clients must construct request bodies for what are conceptually read operations. The REST contract is broken -- `POST` implies resource creation, not retrieval.

---

### 8. File Upload Endpoints Accept Any File Type

**Where**: `app/auth/route.py:161-170` (doctor signup), `app/services/s3_service.py` (S3 upload).

`config.py:78` defines `ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf'}` but this set is **never checked** anywhere. The S3 service uploads whatever file is provided, regardless of extension or MIME type.

**Impact**: Users can upload executable files (`.exe`, `.sh`, `.bat`), HTML files (stored XSS via S3), or arbitrarily large files (up to the 16MB Flask limit). Private bucket files served via presigned URLs could deliver malicious content.

---

## MEDIUM

### 9. Inconsistent URL Naming Conventions

**Where**: Across all blueprints.

Blueprint prefixes use kebab-case: `doctor-analytics`, `doctor-attendance`, `field-approval`, `page-config`, `doctor-profile-config`.

But within blueprints:
- Patient routes: consistent kebab-case (`/profile/personal-details`, `/profile/contact-identity`)
- Doctor routes: mostly kebab-case but some differ (`/appointments/pending-prescriptions`)
- Video routes: use camelCase in request/response bodies (`roomName`, `appointmentId`) while all other modules use snake_case

**Impact**: Frontend engineers must memorize which naming convention each endpoint uses. Auto-generating API clients from a spec would produce inconsistent method names.

---

### 10. Pagination Implemented Differently Everywhere

**Where**: A `@paginate` decorator exists in `app/common/decorators.py:320-351` and a `paginated_response` helper exists in `app/common/responses.py`. Neither is used by any route.

Instead, every paginated route manually parses `page` and `per_page` from query params, with different `max_per_page` caps:
- Admin routes: no cap
- Doctor routes: `min(per_page, 50)`
- Patient routes: `min(per_page, 100)`
- RBAC routes: no cap
- Super admin: `min(per_page, 100)`

**Impact**: An admin could request `per_page=999999` and dump the entire patient table in one query. The inconsistent caps mean frontend pagination components must be tuned per endpoint. The unused decorator and helper are dead code adding confusion.

---

### 11. Appointment State Transitions Via Separate POST Endpoints

**Where**:
- `POST /api/appointment/<id>/cancel`
- `POST /api/appointment/<id>/confirm`
- `POST /api/appointment/<id>/complete`
- `POST /api/doctor/appointments/<id>/accept`
- `POST /api/doctor/appointments/<id>/reject`

Each state transition is a separate endpoint with its own authorization, validation, and error handling -- duplicated across the appointment and doctor blueprints.

**Impact**: There are two ways to "complete" an appointment: `POST /api/appointment/<id>/complete` and `POST /api/doctor/appointments/<id>/complete`. These may or may not have the same business logic. The doctor blueprint has its own `accept`/`reject` endpoints that duplicate state-transition logic from the appointment blueprint. Adding a new state requires adding a new endpoint, new route, new authorization decorator.

---

### 12. Trailing Slash Inconsistency

**Where**: `app/api/common/appointment/routes.py` uses `@appointment_bp.route('/', methods=['POST'])` (trailing slash), while virtually all other routes omit it.

**Impact**: Flask's strict_slashes behavior means `POST /api/appointment` (no slash) returns a 308 redirect to `POST /api/appointment/`. The redirect drops the POST body in some HTTP clients, causing silent failures. Other endpoints don't have this redirect behavior, so the client behavior is inconsistent.

---

### 13. video Routes Use camelCase Request/Response Bodies

**Where**: `app/api/common/video/routes.py` -- request bodies use `roomName`, `appointmentId` (camelCase). All other routes use `snake_case` (`doctor_id`, `appointment_id`, `per_page`).

**Impact**: The frontend must use a different serialization convention for video endpoints vs. everything else. A universal request/response interceptor cannot normalize the casing without endpoint-specific knowledge.

---

## LOW

### 14. Admin Dashboard and User CRUD Are Stubs

**Where**: `app/api/admin/routes.py`:
- `GET /api/admin/dashboard` returns `{'message': 'Dashboard data - To be implemented'}`
- `GET /api/admin/users` returns `{'message': 'List users - To be implemented'}`
- `GET /api/admin/users/<id>` returns `{'message': 'User details - To be implemented'}`
- `PUT /api/admin/users/<id>/status` returns `{'message': 'Update user status - To be implemented'}`
- `GET /api/admin/categories` and `POST /api/admin/categories` are also stubs

**Impact**: These endpoints return 200 with stub messages. Any frontend consuming them would get unexpected data shapes. They should either be removed or return 501 (Not Implemented).

---

### 15. `UpdateProfileSchema` Defined But Never Used

**Where**: `app/auth/validators.py` defines `UpdateProfileSchema`. No route imports or uses it.

**Impact**: Dead code. If profile updates were supposed to be validated, this schema exists but the route bypasses it.
