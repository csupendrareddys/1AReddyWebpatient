# Doctor Module

> **Status**: 🔄 In Progress (40%)  
> **Stack**: React, Redux Toolkit, MUI, Flask-SQLAlchemy

---

## Overview

The Doctor Module enables healthcare providers to manage their practice, including profile setup, qualification management, availability configuration, and patient appointments.

---

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| Doctor Registration | ✅ Complete | Multipart form with document uploads |
| Profile Management | 🔄 In Progress | Edit credentials, bio |
| Qualification Management | ✅ Complete | Degrees, specializations |
| Hospital Affiliation | 🔄 In Progress | Link to hospitals/clinics |
| Service Configuration | 🔄 In Progress | Define consultation types |
| Weekly Schedule | 📋 Planned | Working hours per day |
| Real-time Availability | 🔄 In Progress | Toggle instant availability |
| Appointment Management | 📋 Planned | View, accept, reschedule |
| Prescription Writing | 📋 Planned | Digital prescriptions |
| Patient Questions | 📋 Planned | Intake questionnaires |

---

## Data Models

### Doctor Profile

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Foreign key to User |
| `first_name` | String | Required |
| `last_name` | String | Required |
| `registration_number` | String | Medical license number |
| `state` | String | Registration state |
| `years_of_experience` | Integer | Years in practice |
| `bio` | Text | Profile description |
| `profile_image_url` | String | S3 URL |
| `aadhar_number_encrypted` | String | Government ID (AES-256) |
| `verification_status` | Enum | pending, verified, rejected |
| `is_available` | Boolean | Real-time availability toggle |
| `accepting_appointments` | Enum | auto_accept, manual, auto_reject |

### Doctor Qualifications

```python
class DoctorQualificationDegree:
    id: UUID
    doctor_id: UUID
    degree: str           # MBBS, MD, etc.
    institution: str      # University/College
    year: int             # Year of completion
    certificate_url: str  # S3 URL for certificate
```

### Doctor Specializations

```python
class DoctorQualificationSpecialization:
    id: UUID
    doctor_id: UUID
    category_id: UUID     # FK to Category (e.g., Cardiology)
    is_primary: bool      # Primary specialization
```

### Doctor Services

```python
class DoctorService:
    id: UUID
    doctor_id: UUID
    service_name: Enum    # online_consultation, clinical_consultation, etc.
    price: Decimal        # Consultation fee
    duration_minutes: int # Service duration
    is_active: bool       # Available for booking
```

### Hospital Affiliation

```python
class DoctorHospitalAffiliation:
    id: UUID
    doctor_id: UUID
    hospital_id: UUID
    employment_type: Enum  # full_time, part_time, consultant
    department: str
    start_date: Date
    is_active: bool
```

---

## Service Types

| Service | Code | Typical Duration |
|---------|------|-----------------|
| Online Consultation | `online_consultation` | 15-30 min |
| Instant Consultation | `instant_consultation` | 10-15 min |
| Clinical Consultation | `clinical_consultation` | 20-30 min |
| Patient Home Visit | `patient_home_visit` | 45-60 min |
| Counseling | `counseling` | 45-60 min |
| Vaccination | `vaccination` | 15-20 min |

---

## Registration Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Doctor Registration Flow                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Personal Info       2. Credentials        3. Documents                  │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐           │
│  │ - First Name    │   │ - Reg Number    │   │ - Profile Photo │           │
│  │ - Last Name     │   │ - State         │   │ - Aadhar Copy   │           │
│  │ - Email         │   │ - Experience    │   │ - Certificates  │           │
│  │ - Phone         │   │ - Qualifications│   │                 │           │
│  │ - Password      │   │ - Specializations   │                 │           │
│  └────────┬────────┘   └────────┬────────┘   └────────┬────────┘           │
│           │                     │                     │                     │
│           └─────────────────────┼─────────────────────┘                     │
│                                 │                                           │
│                                 ▼                                           │
│                    ┌───────────────────────┐                               │
│                    │   Submit Registration  │                               │
│                    │   (Multipart Form)     │                               │
│                    └───────────┬───────────┘                               │
│                                │                                           │
│                                ▼                                           │
│                    ┌───────────────────────┐                               │
│                    │   Status: PENDING      │                               │
│                    │   (Awaiting Admin)     │                               │
│                    └───────────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Backend Routes

### Doctor Profile API (`/api/service-provider/doctor`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/profile` | Get doctor profile |
| PUT | `/profile` | Update profile |
| GET | `/qualifications` | List qualifications |
| POST | `/qualifications` | Add qualification |
| DELETE | `/qualifications/<id>` | Remove qualification |

### Services API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/services` | List doctor's services |
| POST | `/services` | Add service |
| PUT | `/services/<id>` | Update service |
| DELETE | `/services/<id>` | Remove service |

### Availability API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/availability` | Get availability settings |
| PUT | `/availability` | Update availability |
| POST | `/availability/toggle` | Toggle real-time status |
| GET | `/availability/logs` | Availability history |

---

## Frontend Structure

```
Frontend/src/features/service-provider/
├── pages/
│   ├── DoctorDashboard/
│   │   └── DoctorDashboard.jsx    # Main doctor dashboard
│   ├── PharmacyDashboard/
│   │   └── PharmacyDashboard.jsx  # Pharmacy dashboard
│   └── DiagnosisDashboard/
│       └── DiagnosisDashboard.jsx # Diagnosis center dashboard
```

### Auth Pages

```
Frontend/src/features/auth/pages/
└── DoctorSignupPage/
    └── DoctorSignupPage.jsx       # Multi-step registration form
```

---

## Patient Intake Questions

### DoctorQuestion Model

```python
class DoctorQuestion:
    id: UUID
    doctor_id: UUID
    question_text: str          # Question content
    question_type: Enum         # text, number, boolean, single_choice, etc.
    options: JSON               # For choice questions
    is_required: bool
    is_active: bool
    display_order: int
```

### Question Types

| Type | Example |
|------|---------|
| `text` | "Describe your symptoms" |
| `number` | "How many days have you had symptoms?" |
| `boolean` | "Do you have fever?" |
| `single_choice` | "Pain intensity: Mild/Moderate/Severe" |
| `multiple_choice` | "Which symptoms apply?" |
| `date` | "When did symptoms start?" |
| `scale` | "Rate your pain (1-10)" |

---

## Prescription System

### Prescription Model

```python
class Prescription:
    id: UUID
    patient_id: UUID
    doctor_id: UUID
    appointment_id: UUID
    diagnosis: str
    notes: str
    status: Enum              # active, expired, cancelled
    next_visit_date: Date
    created_at: DateTime
    
    # Relationship
    medicines: [PrescriptionMedicine]
```

### Medicine in Prescription

```python
class PrescriptionMedicine:
    id: UUID
    prescription_id: UUID
    medicine_id: UUID
    dosage: str               # e.g., "1 tablet"
    frequency: str            # e.g., "3 times daily"
    duration: str             # e.g., "7 days"
    meal_timing: str          # before, after, with meal
    notes: str
```

---

## Future Enhancements

- [ ] Calendar view for appointments
- [ ] Video consultation integration
- [ ] Prescription templates
- [ ] Patient history quick view
- [ ] Earnings dashboard
- [ ] Leave management
- [ ] Referral system
- [ ] Clinical notes (SOAP format)

---

*Last Updated: January 31, 2026*
