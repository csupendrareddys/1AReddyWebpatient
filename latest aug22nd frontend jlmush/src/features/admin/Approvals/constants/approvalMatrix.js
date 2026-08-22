/**
 * Approval-matrix layout — the sections/actions the admin configures, grouped
 * exactly as the spec. `wired: true` = behaviour is enforced today (Phase 1);
 * `wired: false` = the setting is stored but not yet enforced (Phase 2) and the
 * UI shows a subtle "stored, not yet enforced" hint.
 *
 * `key`s must match the backend `PERMISSION_SECTIONS` / `ACTION_KEYS`
 * (app/models/approval_policy.py).
 */

// Admin→Doctor permission (Auto | Manual) per section.
export const PERMISSION_GROUPS = [
    {
        title: 'Non-Recurring — Profile Details',
        rows: [
            { key: 'personal_details', label: 'Personal & Professional Details', wired: true },
            { key: 'signatures', label: 'Signature & Pricing', wired: true },
            { key: 'about_me', label: 'About Me', wired: true },
            { key: 'education', label: 'Education Details', wired: true },
            { key: 'bank_details', label: 'Bank Details', wired: true },
        ],
    },
    {
        title: 'Recurring — Operations',
        rows: [
            { key: 'slot_visibility', label: 'Slot Visibility', wired: true },
            { key: 'consultation_pricing', label: 'Consultation Pricing', wired: true },
            { key: 'working_hours', label: 'Working Hour', wired: true },
        ],
    },
    {
        title: 'Clinical push gates (auto = push straight to patient)',
        rows: [
            { key: 'prescription', label: 'Prescription Approval', wired: true },
            { key: 'document', label: 'Document Approval', wired: true },
            { key: 'group_plan', label: 'Group Plan (service) Approval', wired: true },
        ],
    },
];

// Doctor-Approval / gated actions — 3-way mode, set directly by the admin.
//   appointment_acceptance → the doctor's own accept mode (auto/reject/manual)
//   appointment_cancel / payments → gate on a doctor-initiated action:
//     Auto-accept = proceed, Auto-reject = auto-deny, Manual = HOLD for admin.
export const ACTION_ROWS = [
    { key: 'appointment_acceptance', label: 'Appointment Acceptance Mode', wired: true },
    { key: 'appointment_cancel', label: 'Appointment Cancel', wired: true },
    { key: 'appointment_reschedule', label: 'Appointment Reschedule', wired: false },
    { key: 'payments', label: 'Payments (payout claim)', wired: true },
];

export const PERMISSION_OPTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: 'manual', label: 'Manual' },
];

export const ACTION_OPTIONS = [
    { value: 'auto_accept', label: 'Auto-accept' },
    { value: 'auto_reject', label: 'Auto-reject' },
    { value: 'manual', label: 'Manual' },
];

// The four request-status buckets shown per section.
export const COUNT_KEYS = [
    ['pending', 'Pending', 'warning'],
    ['accepted', 'Accepted', 'success'],
    ['rejected', 'Rejected', 'error'],
    ['query', 'Query', 'info'],
];
