# API Reference

> Complete API endpoint documentation for JLMUSH Healthcare System

---

## Base URL

- **Development**: `http://localhost:5001`
- **Production**: `https://api.jlmush.com` (TBD)

---

## Authentication

All protected endpoints require JWT cookies. CSRF token required for mutating requests.

| Header | Value |
|--------|-------|
| Cookie | `access_token=<jwt>; refresh_token=<jwt>` |
| X-CSRF-TOKEN | `<csrf_token>` (from `csrf_access_token` cookie) |

---

## Auth Endpoints (`/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/signup` | ❌ | Register patient |
| POST | `/signup/doctor` | ❌ | Register doctor (multipart) |
| POST | `/signin` | ❌ | Login |
| POST | `/refresh` | 🔄 | Refresh access token |
| POST | `/logout` | ✅ | Logout current session |
| POST | `/logout-all` | ✅ | Logout all devices |
| POST | `/logout-other` | ✅ | Logout other devices |
| GET | `/me` | ✅ | Get current profile |
| GET | `/sessions` | ✅ | List active sessions |
| DELETE | `/sessions/<id>` | ✅ | Remote logout session |
| POST | `/change-password` | ✅ | Change password |
| POST | `/forgot-password` | ❌ | Request password reset |
| POST | `/reset-password` | ❌ | Reset with token |

---

## Admin Endpoints (`/api/admin`)

### Dashboard
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/dashboard` | any admin | Dashboard statistics |

### Patient Management
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/patients` | view_patients | List patients (paginated) |
| PATCH | `/patients/<id>/status` | edit_patient_status | Update status |

### Doctor Management
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/doctors` | view_doctors | List doctors (paginated) |
| GET | `/doctors/pending` | verify_doctors | Pending verifications |
| POST | `/doctors/<id>/verify` | verify_doctors | Approve doctor |
| POST | `/doctors/<id>/reject` | verify_doctors | Reject doctor |

### Appointment Management
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/appointments` | view_appointments | List appointments |

### User Management (Super Admin)
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/users` | super_admin | List all users |
| GET | `/users/<id>` | super_admin | Get user details |
| PATCH | `/users/<id>/status` | super_admin | Update user status |

### Sub-Admin Management
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/super/sub-admins` | super_admin | List sub-admins |
| POST | `/super/sub-admins` | super_admin | Create sub-admin |
| PUT | `/super/sub-admins/<id>` | super_admin | Update sub-admin |
| DELETE | `/super/sub-admins/<id>` | super_admin | Delete sub-admin |

---

## Patient Endpoints (`/api/patient`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/profile` | Get patient profile |
| PUT | `/profile` | Update profile |
| GET | `/addresses` | List addresses |
| POST | `/addresses` | Add address |
| PUT | `/addresses/<id>` | Update address |
| DELETE | `/addresses/<id>` | Delete address |
| GET | `/house-group` | List family members |
| POST | `/house-group` | Add family member |
| PUT | `/house-group/<id>` | Update member |
| DELETE | `/house-group/<id>` | Remove member |
| GET | `/appointments/upcoming` | Upcoming appointments |
| GET | `/appointments/previous` | Past appointments |
| POST | `/appointments` | Book appointment |
| PUT | `/appointments/<id>/cancel` | Cancel appointment |

---

## Doctor Endpoints (`/api/doctor`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/profile` | Get doctor profile |
| PUT | `/profile` | Update profile |
| GET | `/services` | List services |
| POST | `/services` | Add service |
| PUT | `/services/<id>` | Update service |
| DELETE | `/services/<id>` | Remove service |
| GET | `/availability` | Get availability |
| PUT | `/availability` | Update availability |
| POST | `/availability/toggle` | Toggle status |
| GET | `/appointments` | List appointments |
| PUT | `/appointments/<id>/confirm` | Confirm appointment |
| PUT | `/appointments/<id>/complete` | Complete appointment |

---

## Configuration Endpoints

### Login Config (`/api/config/login`)
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/` | public | Get active config |
| GET | `/<page_type>` | public | Get by page type |
| PUT | `/` | manage_login_config | Update config |

### Page Config (`/api/page-config`)
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/` | super_admin | List configs |
| POST | `/` | super_admin | Create config |
| GET | `/<id>` | super_admin | Get config |
| PUT | `/<id>` | super_admin | Update config |
| POST | `/<id>/publish` | super_admin | Publish config |

---

## Common Endpoints

### Legal (`/api/common/legal`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/terms` | Get terms & conditions |
| GET | `/privacy` | Get privacy policy |

### Symptoms (`/api/common/symptoms`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List all symptoms |

---

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Pagination
```json
{
  "success": true,
  "data": {
    "items": [...],
    "page": 1,
    "per_page": 20,
    "total": 100,
    "pages": 5
  }
}
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/auth/signin` | 5/minute |
| `/auth/signup` | 3/minute |
| `/auth/refresh` | 10/minute |
| General API | 100/minute |

---

*Last Updated: January 31, 2026*
