# Architecture Critique

> Audit Date: 2026-04-13
> Scope: System design, coupling/cohesion, service boundaries, scalability

---

## CRITICAL

### 1. APScheduler Runs Inside Every Gunicorn Worker

**Where**: `app/common/__init__.py:84-115` (`_start_scheduler`)

`_start_scheduler()` is called inside `create_app()`. With Gunicorn's preloaded workers (e.g., `--workers 4`), this means the payment expiry job and the video room pre-creation job each run **4 times concurrently**. There is no leader election, distributed lock, or single-worker guard.

**Impact**: Duplicate payment expirations could race against each other. Two workers could expire the same appointment simultaneously, one committing while the other gets a stale row. The video room scheduler could create duplicate Twilio rooms for the same appointment. With horizontal scaling (multiple EC2 instances), this problem multiplies.

---

### 2. Secrets Were Committed to Git History

**Where**: `.env.development`, `.env.production` (on disk, not currently tracked), but `git log --all -- ".env*"` shows commits `3e54b9d` and `645a390` touched these files.

While `.gitignore` now excludes `.env*` files, the git history still contains:
- Real AWS `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY`
- Real RDS database credentials (username, password, hostname)
- Real `ENCRYPTION_KEY` (Fernet) used for PII encryption
- Real `SECRET_KEY` and `JWT_SECRET_KEY`

**Impact**: Anyone who clones the repo (or had access historically) can extract production credentials. The Fernet encryption key exposure means every encrypted email and phone number in the database can be decrypted by anyone with repo access. AWS keys grant access to S3 buckets containing medical documents and prescriptions.

---

### 3. App Factory Lives in `app/common/__init__.py`, Not `app/__init__.py`

**Where**: `app/__init__.py` is empty (1 line). `app/common/__init__.py` contains `create_app()`.

This violates Flask's canonical pattern where `create_app()` lives in the package root. Every developer, tool, and framework that expects `from app import create_app` will fail. The actual import path is `from app.common import create_app`, which places the factory inside a submodule named "common" -- semantically wrong since the factory is the application root, not a shared utility.

**Impact**: Confuses onboarding engineers. Breaks conventions that tools like `flask run`, pytest fixtures, and IDE auto-discovery rely on. `wsgi.py` has to use the non-standard import path.

---

## HIGH

### 4. No Service Layer Boundary -- Mixed Patterns

**Where**: Compare `app/auth/service.py` (dedicated `AuthService` class) vs. `app/api/admin/routes.py` (raw `db.session.query()` inside route handlers).

Some modules have proper service classes (auth, appointment, video, timeslot, prescription, RBAC). Others embed business logic and database queries directly in route functions (admin core, config, billing_config, medicine_catalog, payout, doctor_attendance, doctor_analytics).

**Impact**: Routes that query the database directly cannot be unit tested without spinning up a Flask request context and a database. Business logic is interleaved with HTTP concerns (request parsing, response formatting), making it impossible to reuse logic across different entry points (CLI scripts, background jobs, websockets). When two routes need the same query, it gets copy-pasted rather than centralized.

---

### 5. Dual Permission Systems With Incomplete Migration

**Where**: `app/common/decorators.py:139-246` (legacy `permission_required` with `_LEGACY_TO_RBAC` mapping of only 9 permissions) and `app/common/permission_decorators.py` (new RBAC decorators `require_permission`, `require_any_permission`, `require_all_permissions`, `with_data_range`).

The new RBAC system in `permission_decorators.py` is fully implemented but **not used by a single route**. Meanwhile, the old `permission_required` decorator maps only 9 legacy permissions to RBAC and falls back to checking a JSON list on the Admin model for anything unmapped.

**Impact**: Two permission decorator files exist, maintained independently, with different user-resolution logic (`current_user` vs `_get_current_admin()` from JWT identity). The legacy fallback path (`perm_value in (admin_profile.permissions or [])`) bypasses the RBAC role/permission matrix entirely, creating a shadow authorization path. Adding new permissions requires deciding which system to use, and the answer is unclear.

---

### 6. Vestigial Flask-Login Integration

**Where**: `app/extensions.py:24` (`login_manager = LoginManager()`), line 90 (`login_manager.init_app(app)`), line 110 (`login_manager.login_view = 'auth.signin'`).

Flask-Login is initialized, configured, and imported but never functionally used. Authentication is handled entirely by Flask-JWT-Extended with cookie-based tokens. The `User` model inherits from `UserMixin` (line 304 of `model.py`), adding `is_authenticated`, `is_active`, etc. properties that are never called.

**Impact**: Adds a dependency that increases attack surface and maintenance burden for zero value. Creates confusion about which auth system is canonical. The `login_view` redirect (`auth.signin`) would only trigger for `@login_required` decorators, which are never used.

---

### 7. Monolithic Model File Prevents Domain Isolation

**Where**: `model.py` (5135 lines, 68+ model classes) and `Rbac.py` (1494 lines) at the project root.

Every model -- from User to Appointment to MarketplaceOrder to PrescriptionTemplate to LoginPageConfig -- lives in a single file. The `app/models/` directory exists but is empty. All cross-module imports go through one file, meaning changing `AppointmentRating` requires loading/parsing all 5135 lines including `BillingConfig`, `HouseGroupMember`, and `PrescriptionTemplate`.

**Impact**: IDE performance degrades with 5000+ line files. Merge conflicts are frequent when multiple developers touch different models. There is no domain separation -- a payment model, a configuration model, and a healthcare model all share the same namespace. Circular dependency between `model.py` and `Rbac.py` is managed by importing RBAC models at the bottom of `model.py` (line 5126-5135), a fragile workaround.

---

### 8. No Horizontal Scaling Strategy for Stateful Components

**Where**: In-memory OTP store in `app/api/service_reciever/patient/service.py:23-89` (`_otp_store = {}`), APScheduler in-process, Redis as single point of failure for auth.

The patient OTP service uses a Python dict (`_otp_store = {}`) instead of Redis. This means OTPs are lost on process restart and are not shared across Gunicorn workers. A patient could request an OTP on worker 1, then the verification request hits worker 2 and fails.

**Impact**: Multi-worker deployments (standard Gunicorn setup) break OTP verification for patient profile changes. Deploying to multiple instances breaks it further. This is explicitly noted in the code as "for testing - use Redis in production" but has not been migrated.

---

## MEDIUM

### 9. CORS Wildcard With Credentials in Development Config

**Where**: `config.py:123` (`CORS_ORIGINS = '*'`), `app/extensions.py:76-77` (converts `*` to `re.compile(r"^.*$")` regex with `supports_credentials: True`).

The development config sets CORS to accept all origins while also supporting credentials (cookies). Flask-CORS normally rejects `*` with credentials per the spec, but the regex workaround bypasses this protection.

**Impact**: If this configuration leaks to staging or any non-localhost deployment, any website can make authenticated requests to the API using the user's cookies. This is a credential theft vector. The regex pattern `^.*$` matches literally every origin, including attacker-controlled domains.

---

### 10. No Error Tracking or Observability Integration

**Where**: Entire codebase -- no Sentry, Datadog, New Relic, or OpenTelemetry integration. Errors are logged to stdout/stderr via Python's `logging` module only.

**Impact**: In production, unhandled exceptions are only visible in CloudWatch logs (if configured). There is no alerting, no error grouping, no stack trace aggregation. A 500 error spike would go unnoticed until users complain. The request logging middleware (lines 118-173 of `app/common/__init__.py`) provides timing data but only to debug-level logs, which are typically disabled in production.

---

### 11. Background Jobs Lack Idempotency Guards

**Where**: `app/api/common/payment/expiry_job.py`, `app/api/common/video/room_scheduler.py`

The payment expiry job queries for stale `PENDING_PAYMENT` appointments and expires them. The video room scheduler creates Twilio rooms for upcoming appointments. Neither job has:
- Distributed locking (Redis lock, PostgreSQL advisory lock)
- Idempotency keys
- Last-run timestamps to avoid reprocessing

**Impact**: Combined with issue #1 (scheduler per worker), the same appointment could be expired or have rooms created multiple times. Even with a single worker, if the job takes longer than its interval (5 min for payments, 1 min for video), jobs overlap.

---

## LOW

### 12. `SQLALCHEMY_ECHO` Set Twice in DevelopmentConfig

**Where**: `config.py:114` (`SQLALCHEMY_ECHO = True`) and line 116 (`SQLALCHEMY_ECHO = False`).

The second assignment silently overrides the first. This is either dead code or a debugging toggle someone forgot to remove.

---

### 13. Production Cookie Domain Hardcoded

**Where**: `config.py:152` (`JWT_COOKIE_DOMAIN = '.laraclinic.org'`), line 153 (`SESSION_COOKIE_DOMAIN = '.laraclinic.org'`).

The production cookie domain is hardcoded rather than configurable via environment variable.

**Impact**: Deploying to a different domain (staging subdomain, different TLD) requires a code change and redeploy rather than an environment variable update.
