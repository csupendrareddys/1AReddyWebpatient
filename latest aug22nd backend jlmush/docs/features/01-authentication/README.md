# Authentication System

> **Status**: ✅ Complete (80%)  
> **Stack**: Flask-JWT-Extended, Redis, PostgreSQL, Werkzeug

---

## Overview

The authentication system implements a secure, session-based JWT architecture with HTTP-only cookies, single-use refresh tokens, and Redis-backed session validation.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Authentication Flow                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Client                 Backend                     Redis        PostgreSQL │
│    │                       │                          │              │      │
│    │─── POST /signin ────→ │                          │              │      │
│    │                       │─── Verify Credentials ──────────────────→      │
│    │                       │                          │              │      │
│    │                       │←── User Data ──────────────────────────        │
│    │                       │                          │              │      │
│    │                       │─── Cache Session ───────→│              │      │
│    │                       │                          │              │      │
│    │                       │─── Store Session ───────────────────────→      │
│    │                       │                          │              │      │
│    │←── Set Cookies ────── │   (access_token +        │              │      │
│    │                       │    refresh_token +       │              │      │
│    │                       │    csrf_tokens)          │              │      │
│    │                       │                          │              │      │
│    │─── API Request ─────→ │                          │              │      │
│    │   (with cookies)      │                          │              │      │
│    │                       │─── Check Session ───────→│              │      │
│    │                       │←── Valid ───────────────                │      │
│    │                       │                          │              │      │
│    │←── Response ───────── │                          │              │      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Token Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Access Token Expiry | 10 minutes | Short-lived for security |
| Refresh Token Expiry | 10 days | Extended session lifetime |
| Token Rotation Threshold | 5 days | Rotate refresh if older |
| Session Hard Limit | 30 days | Force re-login |
| Max Sessions Per User | 5 | Concurrent device limit |

---

## Security Features

### 1. HTTP-Only Cookies
```python
JWT_TOKEN_LOCATION = ['cookies']
JWT_COOKIE_SECURE = True  # HTTPS only in production
JWT_COOKIE_SAMESITE = 'Lax'
```

### 2. CSRF Protection
```python
JWT_COOKIE_CSRF_PROTECT = True
JWT_CSRF_IN_COOKIES = True  # JS-accessible CSRF token
JWT_CSRF_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
```

### 3. Encrypted Sensitive Data (AES-256)

| Field | Storage | Searchable |
|-------|---------|------------|
| Email | `_email_encrypted` | Via `_email_hash` (SHA-256) |
| Phone | `_phone_encrypted` | Via `_phone_hash` (SHA-256) |

### 4. Password Security
- Werkzeug PBKDF2-SHA256 hashing
- Account lockout after 5 failed attempts (15 min)
- Password strength validation (8+ chars, uppercase, lowercase, digit, special)

### 5. Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Login | 5/minute per IP |
| Signup | 3/minute per IP |
| Refresh | 10/minute |
| General API | 100/minute |

---

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Register new patient |
| POST | `/auth/signup/doctor` | Register new doctor (multipart) |
| POST | `/auth/signin` | Login |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Reset with token |

### Protected Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout current session |
| POST | `/auth/logout-all` | Logout all devices |
| POST | `/auth/logout-other` | Logout other devices |
| GET | `/auth/me` | Get current profile |
| GET | `/auth/sessions` | List active sessions |
| DELETE | `/auth/sessions/<id>` | Remote logout session |
| POST | `/auth/change-password` | Change password |

---

## Session Management

### Redis Session Store

```
session:{session_id}     → JSON data (TTL: 10 days)
user_sessions:{user_id}  → Set of session_ids
```

### Session Data Structure

```json
{
  "user_id": "uuid",
  "session_id": "uuid",
  "role": "patient|doctor|super_admin|sub_admin",
  "created_at": "timestamp",
  "expires_at": "timestamp",
  "device_info": {
    "user_agent": "...",
    "ip_address": "..."
  }
}
```

---

## Role-Based Access Control

### Available Roles

| Role | Access Level |
|------|--------------|
| `super_admin` | Full platform access |
| `sub_admin` | Permission-based access |
| `doctor` | Doctor dashboard & features |
| `patient` | Patient portal |
| `pharmacy` | Pharmacy dashboard |
| `diagnosis` | Diagnosis center dashboard |

### Permission Decorators

```python
from app.common.decorators import require_role, require_any_role

@jwt_required()
@require_role(UserRole.SUPER_ADMIN)
def admin_only():
    pass

@jwt_required()
@require_any_role([UserRole.DOCTOR, UserRole.PATIENT])
def dashboard():
    pass
```

### Sub-Admin Permissions

| Permission | Description |
|------------|-------------|
| `view_patients` | List patients |
| `edit_patient_status` | Activate/block patients |
| `view_appointments` | View all appointments |
| `view_doctors` | List doctors |
| `verify_doctors` | Approve/reject doctors |
| `manage_login_config` | Configure login pages |

---

## File Structure

```
Backend/app/auth/
├── __init__.py           # Blueprint registration
├── route.py              # API endpoints (533 lines)
├── service.py            # Business logic (19KB)
├── session_store.py      # Redis session management (11KB)
├── validators.py         # Input validation (21KB)
└── AUTH_MODULE_GUIDE.md  # Developer documentation
```

---

## Frontend Integration

### Auth State (Redux)

```javascript
// features/auth/redux/authSlice.js
{
  user: null,
  isAuthenticated: false,
  isLoading: true,
  role: null,
  permissions: []
}
```

### Route Guards

```jsx
// Guest routes (login, signup)
<GuestRoute>
  <LoginPage />
</GuestRoute>

// Protected routes with role check
<ProtectedRoute allowedRoles={['patient']}>
  <PatientDashboard />
</ProtectedRoute>
```

---

## Future Improvements

- [ ] OAuth2/Social Login (Google, Apple)
- [ ] Two-Factor Authentication (2FA)
- [ ] Passkey support (WebAuthn)
- [ ] Magic link login
- [ ] Device fingerprinting

---

*Last Updated: January 31, 2026*
