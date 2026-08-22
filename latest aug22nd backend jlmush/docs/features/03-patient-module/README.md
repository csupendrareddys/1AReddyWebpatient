# Patient Module

> **Status**: 🔄 In Progress (50%)  
> **Stack**: React, Redux Toolkit, MUI, Flask-SQLAlchemy

---

## Overview

The Patient Module allows patients to manage their healthcare journey including profile management, appointment booking, viewing health records, and managing family members.

---

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| Patient Registration | ✅ Complete | Email/phone signup with OTP verification |
| Profile Management | ✅ Complete | Edit personal info, addresses |
| House Group (Family) | 🔄 In Progress | Manage family members |
| Doctor Search | 📋 Planned | Filter doctors by specialization |
| Appointment Booking | 🔄 In Progress | Book consultations |
| Health Records | 📋 Planned | View lab reports, prescriptions |
| Symptom Selection | 🔄 In Progress | Pre-appointment symptoms |
| Ratings & Reviews | 📋 Planned | Rate completed appointments |

---

## Data Models

### Patient

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Foreign key to User |
| `first_name` | String | Required |
| `last_name` | String | Required |
| `date_of_birth` | Date | Optional |
| `gender` | Enum | male, female, other |
| `blood_group` | Enum | 8 blood types |
| `emergency_contact` | String | Emergency phone |
| `languages_known` | JSON | Array of languages |
| `profile_image_url` | String | S3 URL |

### House Group Member

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `patient_id` | UUID | Owner patient |
| `first_name` | String | Member name |
| `last_name` | String | Member name |
| `relationship` | String | e.g., spouse, child |
| `date_of_birth` | Date | DOB |
| `gender` | Enum | Gender |
| `blood_group` | Enum | Blood type |

---

## Backend Routes

### Patient API (`/api/patient`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/profile` | Get patient profile |
| PUT | `/profile` | Update profile |
| GET | `/addresses` | List addresses |
| POST | `/addresses` | Add address |
| PUT | `/addresses/<id>` | Update address |
| DELETE | `/addresses/<id>` | Delete address |

### House Group API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/house-group` | List family members |
| POST | `/house-group` | Add family member |
| PUT | `/house-group/<id>` | Update member |
| DELETE | `/house-group/<id>` | Remove member |

### Appointment API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/appointments/upcoming` | Upcoming appointments |
| GET | `/appointments/previous` | Past appointments |
| POST | `/appointments` | Book appointment |
| PUT | `/appointments/<id>/cancel` | Cancel appointment |

---

## Frontend Structure

```
Frontend/src/features/service-receiver/
├── components/
│   ├── AppointmentCard/          # Appointment display
│   ├── DoctorCard/               # Doctor listing
│   ├── FamilyMemberCard/         # House group member
│   ├── HealthRecordCard/         # Health records
│   └── SymptomSelector/          # Symptom selection
├── hooks/
│   └── usePatientData.js         # Data fetching hooks
├── pages/
│   ├── PatientDashboard/         # Main dashboard
│   │   ├── PatientDashboard.jsx
│   │   └── PatientDashboard.css
│   └── ProfileSetting/           # Profile management
│       ├── ProfileSetting.jsx
│       └── ProfileSetting.css
└── redux/
    └── patientSlice.js           # Patient state
```

---

## Frontend Pages

### Patient Dashboard
- **Route**: `/dashboard/patient`
- **Access**: `patient` role required
- **Features**:
  - Profile summary card
  - Upcoming appointments
  - Quick actions (book, view records)

### Profile Settings
- **Route**: `/dashboard/patient/profile`
- **Access**: `patient` role required
- **Tabs**:
  - Personal Information
  - Addresses
  - Family Members
  - Preferences

---

## Symptom System

### Symptom Model

```python
class Symptom:
    id: UUID
    name: str           # e.g., "Headache"
    description: str    # Detailed description
    category: str       # e.g., "General", "Respiratory"
    is_active: bool     # Show in selection
```

### Appointment-Symptom Association

```python
class AppointmentSymptom:
    id: UUID
    appointment_id: UUID
    symptom_id: UUID
    severity: int        # 1-5 scale
    notes: str           # Additional context
```

---

## State Management

```javascript
// patientSlice.js
const initialState = {
  profile: null,
  addresses: [],
  familyMembers: [],
  upcomingAppointments: [],
  previousAppointments: [],
  healthRecords: [],
  loading: false,
  error: null
};
```

---

## API Integration

```javascript
// Using RTK Query
const patientApi = createApi({
  endpoints: (builder) => ({
    getProfile: builder.query({
      query: () => '/api/patient/profile',
    }),
    updateProfile: builder.mutation({
      query: (data) => ({
        url: '/api/patient/profile',
        method: 'PUT',
        body: data,
      }),
    }),
    // ... more endpoints
  }),
});
```

---

## Future Enhancements

- [ ] Doctor search with filters (specialty, availability, rating)
- [ ] Video consultation integration
- [ ] Prescription download (PDF)
- [ ] Payment history
- [ ] Health metrics dashboard
- [ ] Appointment reminders (push notifications)
- [ ] Medical document upload

---

*Last Updated: January 31, 2026*
