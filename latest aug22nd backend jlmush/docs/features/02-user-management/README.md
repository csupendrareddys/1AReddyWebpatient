# User Management System

> **Status**: 🔄 In Progress (60%)  
> **Stack**: Flask-SQLAlchemy, PostgreSQL, Marshmallow

---

## Overview

The user management system provides hierarchical user roles with profile extensions for different actor types (Patient, Doctor, Pharmacy, Diagnosis, Admin).

---

## User Model Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User Model (Base)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  id (UUID)              │  Primary key                                      │
│  email                  │  Encrypted (AES-256) + Hash for search            │
│  phone_number           │  Encrypted (AES-256) + Hash for search            │
│  password_hash          │  PBKDF2-SHA256                                    │
│  role                   │  Enum: patient, doctor, pharmacy, diagnosis,      │
│                         │        super_admin, sub_admin                     │
│  status                 │  Enum: active, inactive, pending, blocked         │
├─────────────────────────────────────────────────────────────────────────────┤
│                           Profile Extensions                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Patient    │  Doctor     │  Pharmacy    │  Admin       │  Diagnosis        │
│  ├─ DOB     │  ├─ RegNo   │  ├─ License  │  ├─ Name     │  ├─ License       │
│  ├─ Gender  │  ├─ Exp     │  ├─ Name     │  ├─ Perms    │  ├─ Name          │
│  ├─ Blood   │  ├─ Verify  │  ├─ Address  │  └─ Verify   │  └─ Verify        │
│  └─ House   │  └─ Quals   │  └─ Status   │              │                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## User Roles

| Role | Code | Description |
|------|------|-------------|
| Super Admin | `super_admin` | Full platform access, bypasses all permission checks |
| Sub Admin | `sub_admin` | Limited admin with granular permissions |
| Patient | `patient` | Healthcare service receiver |
| Doctor | `doctor` | Primary service provider |
| Pharmacy | `pharmacy` | Medicine provider |
| Diagnosis | `diagnosis` | Lab/diagnostic center |

---

## User Statuses

| Status | Code | Description |
|--------|------|-------------|
| Active | `active` | Full access to features |
| Inactive | `inactive` | Account deactivated |
| Pending | `pending` | Awaiting verification |
| Blocked | `blocked` | Access suspended |

---

## Profile Models

### Patient Profile

```python
class Patient:
    id: UUID                    # Primary key
    user_id: UUID              # FK to User
    first_name: str            # Required
    last_name: str             # Required
    date_of_birth: Date        # Optional
    gender: Enum               # male, female, other
    blood_group: Enum          # 8 blood types
    emergency_contact: str     # Optional
    languages_known: JSON      # Array of languages
    profile_image_url: str     # S3 URL
    
    # Relationships
    addresses: [Address]
    appointments: [Appointment]
    house_group: [HouseGroupMember]
    health_records: [HealthRecord]
```

### Doctor Profile

```python
class Doctor:
    id: UUID                       # Primary key
    user_id: UUID                 # FK to User
    first_name: str               # Required
    last_name: str                # Required
    registration_number: str      # Medical license
    state: str                    # Registration state
    years_of_experience: int      # Years in practice
    bio: str                      # Profile description
    profile_image_url: str        # S3 URL
    aadhar_number_encrypted: str  # Government ID (encrypted)
    verification_status: Enum     # pending, verified, rejected
    accepting_appointments: Enum  # auto_accept, manual, auto_reject
    is_available: bool            # Real-time availability
    
    # Relationships
    qualifications: [DoctorQualificationDegree]
    specializations: [DoctorQualificationSpecialization]
    hospital_affiliations: [DoctorHospitalAffiliation]
    services: [DoctorService]
    appointments: [Appointment]
    questions: [DoctorQuestion]
    prescriptions: [Prescription]
```

### Admin Profile

```python
class Admin:
    id: UUID                    # Primary key
    user_id: UUID              # FK to User
    first_name: str            # Required
    last_name: str             # Required
    department: str            # Optional
    verification_status: Enum  # pending, verified, rejected
    permissions: JSON          # Array of permission strings
    
    # Methods
    has_permission(permission)     # Check single permission
    has_any_permission([perms])    # Check any of list
    has_all_permissions([perms])   # Check all of list
```

### Pharmacy Profile

```python
class Pharmacy:
    id: UUID                    # Primary key
    user_id: UUID              # FK to User
    name: str                  # Required
    license_number: str        # Required
    address: str               # Location
    verification_status: Enum  # pending, verified, rejected
```

---

## Database Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | Core user data | email_hash, phone_hash, role, status |
| `user_sessions` | Active sessions | refresh_token_hash, device_info, expires_at |
| `patients` | Patient profiles | user_id, first_name, dob, gender |
| `doctors` | Doctor profiles | user_id, registration_number, verification_status |
| `admins` | Admin profiles | user_id, permissions, department |
| `pharmacies` | Pharmacy profiles | user_id, license_number |
| `addresses` | User addresses | user_id, type, street, city, state, pincode |

---

## Related Models

### Address

```python
class Address:
    id: UUID
    user_id: UUID
    address_type: Enum    # home, office, relative, temporary
    street: str
    landmark: str
    city: str
    state: str
    pincode: str
    is_default: bool
```

### House Group Member (Family Members)

```python
class HouseGroupMember:
    id: UUID
    patient_id: UUID      # Owner of family group
    first_name: str
    last_name: str
    relationship: str     # father, mother, spouse, child, etc.
    date_of_birth: Date
    gender: Enum
    blood_group: Enum
    profile_image_url: str
```

---

## API Endpoints

### User Management (Admin)

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/admin/users` | super_admin | List all users |
| GET | `/api/admin/users/<id>` | super_admin | Get user details |
| PATCH | `/api/admin/users/<id>/status` | super_admin | Update user status |

### Patient Management

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/admin/patients` | view_patients | List patients (paginated) |
| PATCH | `/api/admin/patients/<id>/status` | edit_patient_status | Update patient status |

### Doctor Management

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/admin/doctors` | view_doctors | List doctors (paginated) |
| GET | `/api/admin/doctors/pending` | verify_doctors | Get pending verifications |
| POST | `/api/admin/doctors/<id>/verify` | verify_doctors | Approve doctor |
| POST | `/api/admin/doctors/<id>/reject` | verify_doctors | Reject doctor |

---

## Verification Workflow

```
    Doctor Signup
         │
         ▼
    ┌─────────────┐
    │  PENDING    │
    │   Status    │
    └──────┬──────┘
           │
    Admin Reviews Documents
           │
           ▼
    ┌─────────────┬─────────────┐
    │   VERIFY    │   REJECT    │
    │             │   + Reason  │
    └──────┬──────┴──────┬──────┘
           │             │
           ▼             ▼
    ┌───────────┐  ┌───────────┐
    │ VERIFIED  │  │ REJECTED  │
    │ Can Login │  │ Blocked   │
    └───────────┘  └───────────┘
```

---

## Frontend Pages

### Patient
- `PatientDashboard` - Main dashboard
- `ProfileSetting` - Edit profile, addresses

### Doctor
- `DoctorDashboard` - Main dashboard
- `DoctorSignupPage` - Registration with file uploads

### Admin
- `ViewPatients` - Patient list with status management
- `ViewDoctors` - Doctor list with verification
- `ManageAdmins` - Sub-admin management

---

## Future Features

- [ ] Patient profile completion wizard
- [ ] Doctor availability calendar
- [ ] Bulk user import/export
- [ ] User activity logs
- [ ] Profile image cropping

---

*Last Updated: January 31, 2026*
