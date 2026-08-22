# Appointment System

> **Status**: 🔄 In Progress (25%)  
> **Stack**: Flask-SQLAlchemy, PostgreSQL

---

## Overview

The appointment system manages the booking workflow between patients and healthcare providers (doctors, pharmacies, diagnosis centers).

---

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| Appointment Booking | 🔄 In Progress | Core booking flow |
| Appointment Status Management | 🔄 In Progress | Status transitions |
| Symptom Attachment | ✅ Complete | Link symptoms to appointments |
| Document Upload | 📋 Planned | Attach reports/images |
| Ratings/Reviews | 📋 Planned | Post-appointment feedback |
| Rescheduling | 📋 Planned | Change appointment time |
| Cancellation | 📋 Planned | Cancel with reason |

---

## Data Models

### Appointment

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `patient_id` | UUID | FK to Patient |
| `doctor_id` | UUID | FK to Doctor |
| `hospital_id` | UUID | FK to Hospital (optional) |
| `service_id` | UUID | FK to DoctorService |
| `appointment_date` | Date | Date of appointment |
| `start_time` | Time | Start time |
| `end_time` | Time | End time |
| `appointment_type` | Enum | online, in_clinic, home_visit |
| `status` | Enum | pending, confirmed, in_progress, completed, cancelled, no_show |
| `consultation_fee` | Decimal | Fee amount |
| `notes` | Text | Patient notes |
| `cancellation_reason` | Text | If cancelled |
| `is_follow_up` | Boolean | Follow-up flag |
| `parent_appointment_id` | UUID | Link to original if follow-up |

### Appointment Statuses

```
┌─────────────┐
│   PENDING   │ ← Initial state
└──────┬──────┘
       │
       ▼ (Doctor/Auto accepts)
┌─────────────┐
│  CONFIRMED  │
└──────┬──────┘
       │
       ▼ (Appointment starts)
┌─────────────┐
│ IN_PROGRESS │
└──────┬──────┘
       │
       ▼ (Consultation ends)
┌─────────────┐
│  COMPLETED  │
└─────────────┘

Alternative flows:
- PENDING/CONFIRMED → CANCELLED (by patient/doctor)
- CONFIRMED → NO_SHOW (patient didn't attend)
```

### Appointment Symptom

```python
class AppointmentSymptom:
    id: UUID
    appointment_id: UUID
    symptom_id: UUID
    severity: int           # 1-5 scale
    notes: str
```

### Appointment Rating

```python
class AppointmentRating:
    id: UUID
    appointment_id: UUID    # Unique constraint (one per appointment)
    rating: int             # 1-5 stars (check constraint)
    review: str             # Text review
    is_anonymous: bool
    created_at: DateTime
```

### Appointment Document

```python
class AppointmentDocument:
    id: UUID
    appointment_id: UUID
    file_url: str           # S3 URL
    file_type: str          # image/pdf
    uploaded_by_role: str   # patient or doctor
    description: str
    is_deleted: bool
```

---

## API Endpoints

### Patient Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/patient/appointments/upcoming` | List upcoming appointments |
| GET | `/api/patient/appointments/previous` | List past appointments |
| POST | `/api/patient/appointments` | Book new appointment |
| PUT | `/api/patient/appointments/<id>/cancel` | Cancel appointment |
| POST | `/api/patient/appointments/<id>/rating` | Submit rating |
| POST | `/api/patient/appointments/<id>/documents` | Upload document |

### Doctor Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/doctor/appointments` | List all appointments |
| PUT | `/api/doctor/appointments/<id>/confirm` | Confirm appointment |
| PUT | `/api/doctor/appointments/<id>/complete` | Mark completed |
| PUT | `/api/doctor/appointments/<id>/no-show` | Mark no-show |

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/appointments` | List all (paginated) |

---

## Booking Flow

```
1. Patient selects Doctor
           │
           ▼
2. Patient selects Service (consultation type)
           │
           ▼
3. Patient selects Date & Time Slot
           │
           ▼
4. Patient adds Symptoms (optional)
           │
           ▼
5. Patient adds Notes/Documents (optional)
           │
           ▼
6. Payment Processing (if required)
           │
           ▼
7. Appointment Created (status: PENDING)
           │
           ▼
8. Doctor Review
    ├─ Auto Accept → CONFIRMED
    ├─ Manual Accept → CONFIRMED
    └─ Reject → CANCELLED
```

---

## Database Indexes

```python
__table_args__ = (
    Index('ix_appointments_doctor_date', 'doctor_id', 'appointment_date'),
    Index('ix_appointments_patient_date', 'patient_id', 'appointment_date'),
)
```

---

## Future Enhancements

- [ ] Slot-based availability checking
- [ ] Waiting list for fully booked slots
- [ ] Appointment reminders (SMS/Email)
- [ ] Video call integration (Zoom/Google Meet)
- [ ] Multi-doctor appointments
- [ ] Recurring appointments

---

*Last Updated: January 31, 2026*
