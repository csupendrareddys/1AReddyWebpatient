# Architecture Critique v2

> Audit Date: 2026-04-14
> Scope: System design, coupling/cohesion, service boundaries, scalability
> Status: Post-refactoring re-audit

---

## RESOLVED FROM v1

| v1 Issue | Status |
|----------|--------|
| APScheduler runs in every Gunicorn worker | **FIXED** -- Redis leader election (`scheduler:leader` with nx+TTL) ensures single-worker execution |
| App factory in `app/common/__init__.py` | **FIXED** -- Moved to canonical `app/__init__.py`. `wsgi.py` updated |
| Monolithic model.py (5135 lines) | **FIXED** -- Split into 28 modular files under `app/models/` (7120 lines total, domain-driven) |
| Vestigial Flask-Login | **FIXED** -- `LoginManager`, `UserMixin`, all imports fully removed |
| Dual permission systems | **PARTIALLY FIXED** -- `permission_decorators.py` deleted, `permission_required` updated to remove legacy JSON fallback. But the `_LEGACY_TO_RBAC` mapping still exists with only 9 mapped permissions |
| In-memory OTP store | **FIXED** -- Migrated to Redis with `patient_otp:{purpose}:{identifier}` keys and TTL |
| Background jobs lack idempotency | **FIXED** -- Redis locks added to both `expiry_job.py` and `room_scheduler.py` with `try/finally` cleanup |
| Secrets in git history | **NOT ADDRESSED** -- Intentionally deferred per user request. Keys should still be rotated |

---

## REMAINING ISSUES

### HIGH

#### 1. No Service Layer for 60% of Modules

**Where**: Admin core routes, billing_config, medicine_catalog, payout, all *-config routes, field_approval

These modules embed database queries directly in route handlers. For example, `app/api/admin/routes.py` does `db.session.query(Patient).join(User).filter(...)` inside the route function. Compare to `app/api/common/appointment/service.py` which has a dedicated `AppointmentService` class.

**Impact**: Business logic cannot be unit tested without Flask request context. Logic is not reusable across CLI scripts, background jobs, or future GraphQL endpoints. Two routes needing the same query copy-paste the code.

**What was fixed**: This was identified in v1 but intentionally deferred (service-layer refactoring is a large effort, not a code fix).

---

#### 2. `_LEGACY_TO_RBAC` Mapping Covers Only 9 of 11 Permissions

**Where**: `app/common/decorators.py:163-173`

The `permission_required` decorator maps legacy `AdminPermission` strings to RBAC `(PermissionModule, PermissionAction)` tuples. Only 9 mappings exist. The `Admin.permissions` JSON column was deleted, so unmapped permissions now silently deny access (the fallback returns `False`). This is safe but means 2 permissions (`MANAGE_MEDICINE_CATALOG`, `MANAGE_ALLERGY_CATALOG`) have no RBAC mapping and will always be denied for sub-admins.

**Impact**: Sub-admins with `manage_medicine_catalog` or `manage_allergy_catalog` permissions lose access until these are mapped to RBAC modules.

---

#### 3. CORS Wildcard With Credentials Still in Development Config

**Where**: `config.py:123` (`CORS_ORIGINS = '*'`), `app/extensions.py:52-53`

**Unchanged from v1**. Development config allows all origins with credentials. The regex workaround (`re.compile(r"^.*$")`) bypasses the spec's prohibition on `*` with `supports_credentials: True`.

**Impact**: If this config leaks to any non-localhost deployment, any website can make credentialed requests using the user's cookies.

---

### MEDIUM

#### 4. No Error Tracking / Observability Integration

**Where**: Entire codebase

No Sentry, Datadog, or OpenTelemetry. Errors are only logged to stdout. The request timing middleware logs at debug level.

**Impact**: Production 500 spikes are invisible until users report them.

---

#### 5. `app/common/` Still Contains Unrelated Concerns

**Where**: `app/common/__init__.py` is now minimal (just docstring). But the directory still holds: `decorators.py` (route decorators), `encryption.py` (AES/SHA), `responses.py` (HTTP response helpers). Plus a stale `rbac_audit.py.bak` backup file.

**Impact**: Minor. The encryption module is infrastructure, decorators are middleware, responses are HTTP utilities. These could be split into `app/middleware/` and `app/utils/` for clearer separation, but the current state is functional.

---

### LOW

#### 6. `service_reciever` Directory Spelling

**Where**: `app/api/service_reciever/`

"reciever" is a misspelling of "receiver". This is baked into import paths across 15+ files. Renaming requires updating every import.

**Impact**: Cosmetic but signals code quality to new developers.

---

#### 7. Stale Backup Files

**Where**: `model.py.bak`, `Rbac.py.bak`, `app/common/rbac_audit.py.bak`

These are pre-refactoring backups. They contain stale imports (`from Rbac import ...`, `from model import ...`) and old model definitions.

**Impact**: Clutter. Should be deleted once the team confirms the refactoring is stable.
