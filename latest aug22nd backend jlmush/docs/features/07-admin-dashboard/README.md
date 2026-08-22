# Admin Dashboard

> **Status**: 🔄 In Progress (55%)  
> **Stack**: React, Redux Toolkit, MUI, Flask-SQLAlchemy

---

## Overview

The Admin Dashboard provides platform management capabilities for super admins and permission-based access for sub-admins.

---

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| Dashboard Analytics | 🔄 In Progress | Overview statistics |
| Patient Management | ✅ Complete | View/manage patients |
| Doctor Management | ✅ Complete | View/verify doctors |
| Appointment Viewing | ✅ Complete | View all appointments |
| Sub-Admin Management | ✅ Complete | Create/manage sub-admins |
| Login Page Configuration | ✅ Complete | Dynamic login UI |
| Page Configuration (v2) | 🔄 In Progress | Draft/Preview/Publish workflow |
| Category Management | 📋 Planned | Medical specializations |

---

## Admin Roles

### Super Admin
- Full platform access
- Bypasses all permission checks
- Can create/manage sub-admins
- Access to all configuration

### Sub-Admin
- Permission-based access
- Can only access permitted features
- Cannot create other admins

---

## Permissions

| Permission | Code | Description |
|------------|------|-------------|
| View Patients | `view_patients` | List patient records |
| Edit Patient Status | `edit_patient_status` | Activate/block patients |
| View Appointments | `view_appointments` | View all appointments |
| View Doctors | `view_doctors` | List doctor records |
| Verify Doctors | `verify_doctors` | Approve/reject doctors |
| Manage Login Config | `manage_login_config` | Configure login pages |

---

## Backend Routes

### Admin Routes (`/api/admin`)

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/dashboard` | super_admin/sub_admin | Dashboard statistics |
| GET | `/patients` | view_patients | List patients (paginated) |
| PATCH | `/patients/<id>/status` | edit_patient_status | Update patient status |
| GET | `/appointments` | view_appointments | List appointments |
| GET | `/doctors` | view_doctors | List doctors |
| GET | `/doctors/pending` | verify_doctors | Pending verifications |
| POST | `/doctors/<id>/verify` | verify_doctors | Approve doctor |
| POST | `/doctors/<id>/reject` | verify_doctors | Reject doctor |
| GET | `/categories` | super_admin | List categories |
| POST | `/categories` | super_admin | Create category |

### Super Admin Routes (`/api/admin/super`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sub-admins` | List sub-admins |
| POST | `/sub-admins` | Create sub-admin |
| PUT | `/sub-admins/<id>` | Update sub-admin |
| DELETE | `/sub-admins/<id>` | Delete sub-admin |
| PUT | `/sub-admins/<id>/permissions` | Update permissions |

---

## Frontend Structure

```
Frontend/src/features/admin/
├── api/
│   ├── adminApiSlice.js       # RTK Query endpoints
│   └── loginConfigApiSlice.js # Login config API
├── pages/
│   ├── AdminDashboard/
│   │   └── AdminDashboard.jsx   # Main dashboard
│   ├── ManageAdmins/
│   │   └── ManageAdmins.jsx     # Sub-admin management
│   ├── ViewPatients/
│   │   └── ViewPatients.jsx     # Patient list
│   ├── ViewDoctors/
│   │   └── ViewDoctors.jsx      # Doctor list + verification
│   ├── ViewAppointments/
│   │   └── ViewAppointments.jsx # Appointment list
│   ├── LoginConfigPage/
│   │   ├── LoginConfigPage.jsx  # Login page editor
│   │   └── LoginConfigPage.css
│   └── PageConfigEditor/
│       └── PageConfigEditor.jsx # Advanced page config
└── redux/
    └── adminSlice.js            # Admin state
```

---

## Frontend Routes

| Route | Component | Access |
|-------|-----------|--------|
| `/dashboard/admin` | AdminDashboard | super_admin, sub_admin |
| `/dashboard/admin/manage-admins` | ManageAdmins | super_admin only |
| `/dashboard/admin/patients` | ViewPatients | view_patients |
| `/dashboard/admin/doctors` | ViewDoctors | view_doctors |
| `/dashboard/admin/appointments` | ViewAppointments | view_appointments |
| `/dashboard/admin/login-config` | LoginConfigPage | manage_login_config |
| `/dashboard/admin/page-config` | PageConfigEditor | super_admin only |

---

## Permission-Based UI

```jsx
// Dashboard options shown based on permissions
const dashboardOptions = [
  {
    title: 'View Patients',
    permission: 'view_patients',
    route: '/dashboard/admin/patients'
  },
  {
    title: 'View Doctors', 
    permission: 'view_doctors',
    route: '/dashboard/admin/doctors'
  },
  // ... more options
];

// Filter by user permissions
const visibleOptions = dashboardOptions.filter(opt => 
  user.role === 'super_admin' || 
  user.permissions?.includes(opt.permission)
);
```

---

## Dashboard Analytics (Planned)

| Metric | Description |
|--------|-------------|
| Total Users | Active user count by role |
| New Registrations | This week/month |
| Appointments Today | Today's appointments |
| Revenue | Payment statistics |
| Pending Verifications | Doctors awaiting verification |

---

## Future Enhancements

- [ ] Advanced analytics with charts
- [ ] Audit logs viewer
- [ ] Bulk user operations
- [ ] System health monitoring
- [ ] Report generation

---

*Last Updated: January 31, 2026*
