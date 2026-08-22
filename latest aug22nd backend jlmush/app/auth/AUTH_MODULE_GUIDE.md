# Auth Module Developer Guide

Technical documentation for the authentication module.

---

## Architecture Overview

```
Request → JWT Cookie Validation → Redis Session Check → PostgreSQL Fallback → Route Handler
```

### Token Flow

1. **Login** → Access token (10 min) + Refresh token (10 days) stored as HTTP-only cookies
2. **API Request** → Access token validated, session checked in Redis
3. **Token Expired** → Frontend calls `/refresh` endpoint
4. **Refresh** → New access token issued. Refresh token rotated if > 5 days old
5. **Logout** → Session deleted from Redis + PostgreSQL

---

## Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/signup` | ❌ | Register new user |
| POST | `/auth/signin` | ❌ | Login |
| POST | `/auth/refresh` | 🔄 | Refresh access token |
| POST | `/auth/logout` | ✅ | Logout current session |
| POST | `/auth/logout-all` | ✅ | Logout all devices |
| POST | `/auth/logout-other` | ✅ | Logout other devices |
| GET | `/auth/me` | ✅ | Get profile |
| GET | `/auth/sessions` | ✅ | List active sessions |
| DELETE | `/auth/sessions/<id>` | ✅ | Remote logout |
| POST | `/auth/change-password` | ✅ | Change password |

---

## Session Configuration

Edit `config.py` to customize:

```python
# Maximum concurrent sessions per user
MAX_SESSIONS_PER_USER = 1  # Set to 2, 3, etc. for multiple devices

# Rotate refresh token after this many days
SESSION_ROTATION_THRESHOLD_DAYS = 5

# Force re-login after this many days (hard limit)
SESSION_HARD_LIMIT_DAYS = 30
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Login | 5/minute per IP |
| Signup | 3/minute per IP |
| Refresh | 10/minute |
| General API | 100/minute |

---

## Role-Based Access Control

### Available Decorators

```python
from flask_jwt_extended import jwt_required
from app.common.decorators import require_role, require_any_role
from model import UserRole

# Single role required
@app.route('/admin')
@jwt_required()
@require_role(UserRole.SUPER_ADMIN)
def admin_only():
    pass

# Any of multiple roles
@app.route('/dashboard')
@jwt_required()
@require_any_role([UserRole.DOCTOR, UserRole.PATIENT])
def dashboard():
    pass
```

### Available Roles
- `UserRole.SUPER_ADMIN`
- `UserRole.SUB_ADMIN`
- `UserRole.PATIENT`
- `UserRole.DOCTOR`
- `UserRole.PHARMACY`
- `UserRole.DIAGNOSIS`

---

## Encryption

### Encrypted Fields

| Model | Field | Searchable |
|-------|-------|------------|
| User | email | ✅ (via hash) |
| User | phone_number | ✅ (via hash) |

### How It Works

```python
# Setting a value (automatic encryption)
user.email = "test@example.com"
# Internally stores:
#   _email_encrypted = "gAAAAABh..."  (AES-256)
#   _email_hash = "a1b2c3..."         (SHA-256)

# Getting a value (automatic decryption)
print(user.email)  # "test@example.com"

# Searching by encrypted field
from app.common.encryption import hash_for_search
email_hash = hash_for_search("test@example.com")
user = User.query.filter_by(_email_hash=email_hash).first()
```

---

## Redis Session Store

### Key Structure

```
session:{session_id}     → JSON session data (TTL: 10 days)
user_sessions:{user_id}  → Set of session IDs
```

### Usage

```python
from app.auth.session_store import SessionStore

# Cache session
SessionStore.cache_session(session_id, user_id, expires_at)

# Get session
data = SessionStore.get_cached_session(session_id)

# Delete session
SessionStore.delete_session(session_id, user_id)

# Delete all user sessions
SessionStore.delete_all_user_sessions(user_id)
```

---

## Database Migration

After modifying the User model, create a migration:

```bash
flask db migrate -m "Add encrypted email and phone fields"
flask db upgrade
```

### Data Migration Script

For existing data, encrypt during migration:
```python
def upgrade():
    # Add new columns
    op.add_column('users', sa.Column('_email_encrypted', sa.Text()))
    op.add_column('users', sa.Column('_email_hash', sa.String(64)))
    # ... migrate data ...
    op.drop_column('users', 'email')
```

---

## Testing Authentication

```python
# Test signup
response = client.post('/auth/signup', json={
    'email': 'test@example.com',
    'phone_number': '9876543210',
    'password': 'Test@123'
})

# Test signin
response = client.post('/auth/signin', json={
    'email': 'test@example.com',
    'password': 'Test@123'
})

# Access protected route (cookies are automatically sent)
response = client.get('/auth/me')
```
