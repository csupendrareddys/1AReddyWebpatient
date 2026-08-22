# Prescription System

> **Status**: 📋 Planned (15%)  
> **Stack**: Flask-SQLAlchemy, PostgreSQL

---

## Overview

The prescription system enables doctors to create digital prescriptions, manage medicine catalogs, and integrate with pharmacies.

---

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| Prescription Creation | 📋 Planned | Create digital prescriptions |
| Medicine Catalog | 📋 Planned | Medicine database with brands |
| Prescription Templates | 📋 Planned | Reusable prescription templates |
| Pharmacy Integration | 📋 Planned | Send to pharmacy |
| PDF Generation | 📋 Planned | Downloadable prescription |

---

## Data Models

### Prescription

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `patient_id` | UUID | FK to Patient |
| `doctor_id` | UUID | FK to Doctor |
| `appointment_id` | UUID | FK to Appointment (optional) |
| `diagnosis` | Text | Diagnosis notes |
| `notes` | Text | Additional instructions |
| `status` | Enum | active, expired, cancelled |
| `next_visit_date` | Date | Suggested follow-up |
| `created_at` | DateTime | Creation timestamp |

### Medicine Brand

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | Brand name |
| `manufacturer` | String | Manufacturer name |
| `is_active` | Boolean | Available status |

### Medicine

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `brand_id` | UUID | FK to MedicineBrand |
| `name` | String | Medicine name |
| `generic_name` | String | Generic name |
| `formulation` | String | e.g., Tablet, Syrup |
| `strength` | String | e.g., 500mg |
| `is_active` | Boolean | Available status |

### Prescription Medicine

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `prescription_id` | UUID | FK to Prescription |
| `medicine_id` | UUID | FK to Medicine |
| `dosage` | String | e.g., "1 tablet" |
| `frequency` | String | e.g., "3 times daily" |
| `duration` | String | e.g., "7 days" |
| `meal_timing` | String | before, after, with meal |
| `notes` | String | Special instructions |

---

## Prescription Statuses

| Status | Description |
|--------|-------------|
| `active` | Currently valid |
| `expired` | Past validity period |
| `cancelled` | Cancelled by doctor |

---

## Future Implementation

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/doctor/prescriptions` | Create prescription |
| GET | `/api/doctor/prescriptions` | List prescriptions |
| GET | `/api/doctor/prescriptions/<id>` | Get prescription |
| PUT | `/api/doctor/prescriptions/<id>` | Update prescription |
| DELETE | `/api/doctor/prescriptions/<id>` | Cancel prescription |
| GET | `/api/patient/prescriptions` | Patient prescriptions |
| GET | `/api/patient/prescriptions/<id>/pdf` | Download PDF |

---

*Last Updated: January 31, 2026*
