# JLMUSH Healthcare Management System - Phase 1

> **Version**: 1.0.0 (Phase 1)  
> **Last Updated**: January 31, 2026  
> **Status**: Active Development

---

## 📋 Project Overview

JLMUSH is a comprehensive **Healthcare Management System** (HMS) designed to connect patients with healthcare service providers including doctors, pharmacies, and diagnostic centers. The system is built as a modern SaaS platform with multi-tenant support and role-based access control.

### Target Users

| Role | Description |
|------|-------------|
| **Patients** | Book appointments, view health records, manage profiles |
| **Doctors** | Manage appointments, write prescriptions, configure intake questions |
| **Pharmacies** | Handle prescriptions, manage inventory (Phase 2) |
| **Diagnosis Centers** | Process lab reports, integrate with appointments (Phase 2) |
| **Admins** | Super admins & sub-admins manage platform, verify providers |

---

## 🛠️ Technology Stack

### Backend (`/Backend`)

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Flask** | 3.1.2 | Web framework |
| **SQLAlchemy** | 2.0.43 | ORM for PostgreSQL |
| **Flask-JWT-Extended** | 4.7.1 | JWT authentication |
| **PostgreSQL** | 15-alpine | Primary database |
| **Redis** | 7-alpine | Session cache & rate limiting |
| **Flask-Limiter** | 3.5.0 | Rate limiting |
| **Marshmallow** | 4.0.1 | Schema validation |
| **Boto3** | 1.38.0 | AWS S3 integration |
| **Gunicorn** | 21.2.0 | Production WSGI server |

### Frontend (`/Frontend`)

| Technology | Version | Purpose |
|-----------|---------|---------|
| **React** | 18.3.1 | UI framework |
| **Vite** | 6.0.5 | Build tool & dev server |
| **MUI (Material UI)** | 6.4.0 | Component library |
| **Redux Toolkit** | 2.5.0 | State management |
| **React Router DOM** | 6.28.0 | Client-side routing |
| **Axios** | 1.7.9 | HTTP client |
| **date-fns** | 4.1.0 | Date utilities |

### Infrastructure

| Service | Container | Purpose |
|---------|-----------|---------|
| **PostgreSQL** | healthcare-postgres | Relational database |
| **Redis** | healthcare-redis | Session caching, rate limiting |
| **Flask Backend** | healthcare-backend | REST API server |

---

## 📊 Project Completion Status

### Overall Progress: **~45%**

```
Phase 1 Implementation Progress
├── Authentication & Authorization    ████████████████████░░░░░  80%
├── User Management                   ███████████████░░░░░░░░░░  60%
├── Patient Module                    ████████████░░░░░░░░░░░░░  50%
├── Doctor Module                     ██████████░░░░░░░░░░░░░░░  40%
├── Appointment System                ██████░░░░░░░░░░░░░░░░░░░  25%
├── Prescription System               ████░░░░░░░░░░░░░░░░░░░░░  15%
├── Admin Dashboard                   ██████████████░░░░░░░░░░░  55%
├── Pharmacy Module                   ██░░░░░░░░░░░░░░░░░░░░░░░  10%
├── Diagnosis Module                  ██░░░░░░░░░░░░░░░░░░░░░░░  10%
└── Configuration System              ███████████████████░░░░░░  75%
```

### Phase 1 Deliverables

| Feature | Status | Completion |
|---------|--------|------------|
| User Authentication (JWT + Cookies) | ✅ Complete | 100% |
| Multi-device Session Management | ✅ Complete | 100% |
| Role-based Access Control | ✅ Complete | 100% |
| Encrypted Sensitive Data (AES-256) | ✅ Complete | 100% |
| Patient Registration & Profile | ✅ Complete | 90% |
| Doctor Registration & Profile | ✅ Complete | 85% |
| Admin Dashboard | 🔄 In Progress | 60% |
| Doctor Verification System | 🔄 In Progress | 70% |
| Login Page Configuration (SaaS) | ✅ Complete | 90% |
| Page Configuration System (v2) | 🔄 In Progress | 60% |
| Appointment Booking | 🔄 In Progress | 30% |
| Prescription Management | 📋 Planned | 15% |
| Payment Integration | 📋 Planned | 10% |

---

## 📁 Documentation Structure

This documentation is organized into feature-specific folders:

```
docs/
├── README.md                         # This file - project overview
├── features/
│   ├── 01-authentication/           # Auth system documentation
│   ├── 02-user-management/          # User roles & profiles
│   ├── 03-patient-module/           # Patient features
│   ├── 04-doctor-module/            # Doctor features
│   ├── 05-appointment-system/       # Booking & scheduling
│   ├── 06-prescription-system/      # Prescriptions & medicines
│   ├── 07-admin-dashboard/          # Admin features
│   ├── 08-configuration-system/     # Dynamic UI configuration
│   └── 09-infrastructure/           # Docker, deployment
└── api/
    └── api-reference.md             # Complete API documentation
```

---

## 🚀 Quick Start

### Prerequisites
- Docker Desktop
- Node.js 18+
- Python 3.10+

### Development Setup

```bash
# 1. Clone repository
git clone https://github.com/anishdubey123/JILMUSH-WebDeve.git
cd jlmushIITM

# 2. Start Backend (Docker)
cd Backend
docker-compose up -d

# 3. Start Frontend
cd ../Frontend
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5001
- Database: PostgreSQL on port 5432
- Redis: Port 6379

---

## 📞 Support & Contact

For questions or issues, please contact the development team.

---

*Document generated on January 31, 2026*
