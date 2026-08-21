import { createSlice } from '@reduxjs/toolkit';

// Per-slot approval: every dated slot needs a stable id + approval_status.
// New/edited slots default to 'pending'; slots that already carry a status
// (e.g. 'approved' loaded from the backend) keep it until the next save
// re-diffs them server-side.
const slotId = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const stampSlots = (slots) => (Array.isArray(slots) ? slots.map((s) => ({
    ...s,
    id: s.id || slotId(),
    approval_status: s.approval_status || 'pending',
})) : slots);

const DEFAULT_AVAILABILITY_CONFIG = {
    slot_size: 15,       // minutes (multiple of 5)
    slot_gap: 0,         // gap between slots in minutes
    start_ceiling: 5,    // 0 | 5 | 10
    working_days: {},    // Per-type: { video: { "Monday": [...] }, audio: {...}, ... }
                         // Legacy flat: { "Monday": [...] } — auto-normalised on frontend
    exceptions: {},      // { "YYYY-MM-DD": "blocked" }
    day_overrides: {},   // { "YYYY-MM-DD": [{ start, end, consultation_types: [...] }, ...] }
};

const initialPersonalDataState = {
    formData: { 
        profile_image: '',
        first_name: '',
        middle_name: '',
        last_name: '',
        phone_number: '',
        alternate_phone_number: '',
        gender: '',
        dob: null,
        email: '',
        alternate_email: '',
        languages_known: [],
        height: '',
        weight: '',
        category: '',
        religion: '',
        citizenship: ''
    },  
    documentData: {
        aadhar_number: '',
        aadhar_attachment: '',
        pan_number: '',
        pan_attachment: ''
    },
    female_data: {
        LMP_calender: '',
        LMP_remarks: '',
        pregnancy_status: '',
        pregnancy_status_remarks: '',
        
    },
    communication_data: {
      address: '',
      landmark: '',
      city: '',
      district: '',
      state: '',
      pincode: '',
      country: '',  
      gps_location: '',
      address_id_proof_type: '',
      address_id_proof_number: '',
      address_id_proof_attachment: '',
    },
    permanent_address_data: {
      address: '',
      landmark: '',
      city: '',
      district: '',
      state: '',
      pincode: '',
      country: '',  
      gps_location: '',
      address_id_proof_type: '',
      address_id_proof_number: '',
      address_id_proof_attachment: '',
    },
    // ── Availability Config ───────────────────────────────────────────
    availabilityConfig: { ...DEFAULT_AVAILABILITY_CONFIG },
    availabilityApprovalStatus: 'not_submitted',   // fallback global status
    availabilityRejectionReason: null,
    availabilityApprovalRequestedAt: null,
    availabilityApprovedAt: null,

    // ── Granular Approvals ────────────────────────────────────────────
    granularStatus: null, // Holds the per-category/per-type status tree

    // ── Approved snapshots (set by admin, used for backend-enforced validation) ──
    approvedSlotPricing: [],
    approvedWorkingDays: {},
    // Last known admin-approved calendar overrides ({ "YYYY-MM-DD": [slots] }).
    // The backend only tracks calendar approval as one blob (granular_status.calendar),
    // so we snapshot the overrides whenever they are in the "approved" state and use
    // this baseline to tell already-approved dates/slots apart from ones awaiting review.
    approvedDayOverrides: {},

    // ── Legacy calendar overrides (kept for AvailabilityCalendar) ─────
    availableDays: [],
    availableSlots: {},

    // ── UI State ──────────────────────────────────────────────────────
    activeTab: 0,
    loading: false,
    error: null,
    snackbar: {
        open: false,
        message: '',
        severity: 'info',
    },
};

const doctorProfileUiSlice = createSlice({
    name: 'doctorProfileUi',
    initialState: initialPersonalDataState,
    reducers: {
        clearDoctorProfileUiState: () => initialPersonalDataState,
        // ── Profile Form ──────────────────────────────────────────────────
        setFormData: (state, action) => {
            state.formData = { ...state.formData, ...action.payload };
        },
        setFormField: (state, action) => {
            const { name, value } = action.payload;
            state.formData[name] = value;
        },
        setSlotPricing: (state, action) => {
            state.formData.slotPricing = action.payload;
        },
        populateFormFromProfile: (state, action) => {
            const profile = action.payload;
            if (!profile) return;
            state.formData = {
                first_name: profile.first_name || '',
                middle_name: profile.middle_name || '',
                last_name: profile.last_name || '',
                phone_number: profile.user_details?.phone_number || '',
                email: profile.user_details?.email || '',
                // Backend sends dob as an ISO string; the MUI DatePicker needs a
                // Date object or the field renders blank ("DOB not fetched").
                dob: profile.dob ? new Date(profile.dob) : null,
                gender: profile.gender || '',
                profile_image: profile.profile_image || '',
                consultation_fee: profile.consultation_fee || '',
                experience_years: profile.experience_years || '',
                registration_number: profile.registration_number || '',
                slotPricing: profile.slot_pricing || [],
                // New fields
                alternate_phone_number: profile.alternate_phone_number || '',
                alternate_email: profile.alternate_email || '',
                languages_known: profile.languages_known || [],
                height: profile.height || '',
                weight: profile.weight || '',
                category: profile.category || '',
                religion: profile.religion || '',
                citizenship: profile.citizenship || '',
            };
            // Populate document data
            if (profile.documents) {
                state.documentData = {
                    aadhar_number: profile.documents.aadhar_number || '',
                    aadhar_attachment: profile.documents.aadhar_attachment || '',
                    pan_number: profile.documents.pan_number || '',
                    pan_attachment: profile.documents.pan_attachment || '',
                };
            }
            // Populate female data
            if (profile.female_data) {
                state.female_data = {
                    LMP_calender: profile.female_data.LMP_calender || '',
                    LMP_remarks: profile.female_data.LMP_remarks || '',
                    pregnancy_status: profile.female_data.pregnancy_status || '',
                    pregnancy_status_remarks: profile.female_data.pregnancy_status_remarks || '',
                };
            }
            // Populate communication (current) address
            if (profile.communication_address) {
                state.communication_data = { ...state.communication_data, ...profile.communication_address };
            }
            // Populate permanent address
            if (profile.permanent_address) {
                state.permanent_address_data = { ...state.permanent_address_data, ...profile.permanent_address };
            }
        },

        // ── Document Data ─────────────────────────────────────────────────
        setDocumentField: (state, action) => {
            const { name, value } = action.payload;
            state.documentData[name] = value;
        },
        setDocumentData: (state, action) => {
            state.documentData = { ...state.documentData, ...action.payload };
        },

        // ── Female Data ───────────────────────────────────────────────────
        setFemaleField: (state, action) => {
            const { name, value } = action.payload;
            state.female_data[name] = value;
        },

        // ── Communication Address ─────────────────────────────────────────
        setCommunicationField: (state, action) => {
            const { name, value } = action.payload;
            state.communication_data[name] = value;
        },
        setCommunicationData: (state, action) => {
            state.communication_data = { ...state.communication_data, ...action.payload };
        },

        // ── Permanent Address ─────────────────────────────────────────────
        setPermanentAddressField: (state, action) => {
            const { name, value } = action.payload;
            state.permanent_address_data[name] = value;
        },
        copyCommToPermanent: (state) => {
            state.permanent_address_data = {
                ...state.communication_data,
                // Keep existing proof fields
                address_id_proof_type: state.permanent_address_data.address_id_proof_type,
                address_id_proof_number: state.permanent_address_data.address_id_proof_number,
                address_id_proof_attachment: state.permanent_address_data.address_id_proof_attachment,
            };
        },

        // ── Availability Config ───────────────────────────────────────────
        setAvailabilityConfig: (state, action) => {
            state.availabilityConfig = { ...state.availabilityConfig, ...action.payload };
        },
        setAvailabilityField: (state, action) => {
            const { field, value } = action.payload;
            state.availabilityConfig[field] = value;
        },
        setWorkingDays: (state, action) => {
            state.availabilityConfig.working_days = action.payload;
        },
        setExceptions: (state, action) => {
            state.availabilityConfig.exceptions = action.payload;
        },
        toggleException: (state, action) => {
            // action.payload = 'YYYY-MM-DD'
            const dateStr = action.payload;
            const exceptions = { ...state.availabilityConfig.exceptions };
            if (exceptions[dateStr] === 'blocked') {
                delete exceptions[dateStr];
            } else {
                exceptions[dateStr] = 'blocked';
            }
            state.availabilityConfig.exceptions = exceptions;
        },
        setApprovalStatus: (state, action) => {
            const { status, reason, requestedAt, approvedAt } = action.payload;
            if (status !== undefined) state.availabilityApprovalStatus = status;
            if (reason !== undefined) state.availabilityRejectionReason = reason;
            if (requestedAt !== undefined) state.availabilityApprovalRequestedAt = requestedAt;
            if (approvedAt !== undefined) state.availabilityApprovedAt = approvedAt;
        },
        populateAvailabilityFromSchedule: (state, action) => {
            const schedule = action.payload;
            if (!schedule) return;
            
            let config = schedule.availability_config || {};
            
            // Defensive check if it's a string (depends on DB driver/backend)
            if (typeof config === 'string') {
                try {
                    config = JSON.parse(config);
                } catch (e) {
                    console.error('Failed to parse availability_config string', e);
                    config = {};
                }
            }
            state.availabilityConfig = {
                ...DEFAULT_AVAILABILITY_CONFIG,
                ...config,
            };
            
            // Read Granular Status
            if (schedule.granular_status) {
                state.granularStatus = schedule.granular_status;
            }
            
            state.availabilityApprovalStatus = schedule.availability_approval_status || 'not_submitted';
            state.availabilityRejectionReason = schedule.availability_rejection_reason || null;
            state.availabilityApprovalRequestedAt = schedule.availability_approval_requested_at || null;
            state.availabilityApprovedAt = schedule.availability_approved_at || null;
            state.formData.slotPricing = schedule.slot_pricing || [];

            // Store admin-approved snapshots (backend is the single source of truth)
            state.approvedSlotPricing = schedule.approved_slot_pricing || [];
            state.approvedWorkingDays = schedule.approved_working_days || {};

            // Sync legacy calendar state from overrides
            const overrides = state.availabilityConfig.day_overrides || {};
            state.availableSlots = JSON.parse(JSON.stringify(overrides)); // Deep copy to avoid reference issues
            state.availableDays = Object.keys(overrides);

            // Snapshot the approved calendar baseline. The overrides currently in
            // availability_config represent the approved set only while the calendar
            // isn't awaiting review; once a change is submitted the calendar flips to
            // "pending", so we keep the previous approved snapshot untouched then.
            const calendarStatus = schedule.granular_status?.calendar?.status;
            if (calendarStatus === 'approved' || !schedule.granular_status) {
                state.approvedDayOverrides = JSON.parse(JSON.stringify(overrides));
            }
        },

        // ── Legacy Calendar (kept for override support) ───────────────────
        setAvailability: (state, action) => {
            const { days, slots } = action.payload;
            if (days) state.availableDays = days;
            if (slots) state.availableSlots = slots;
        },
        addAvailableDay: (state, action) => {
            const day = action.payload;
            if (!state.availableDays.includes(day)) {
                state.availableDays.push(day);
                if (!state.availableSlots[day]) {
                    state.availableSlots[day] = [];
                    // Keep overrides in sync
                    if (!state.availabilityConfig.day_overrides) state.availabilityConfig.day_overrides = {};
                    state.availabilityConfig.day_overrides[day] = [];
                }
            }
        },
        removeAvailableDay: (state, action) => {
            const day = action.payload;
            state.availableDays = state.availableDays.filter(d => d !== day);
            delete state.availableSlots[day];
            // Keep overrides in sync
            if (state.availabilityConfig.day_overrides) {
                delete state.availabilityConfig.day_overrides[day];
            }
        },
        updateDaySlots: (state, action) => {
            const { day, slots } = action.payload;
            const stamped = stampSlots(slots);
            state.availableSlots[day] = stamped;
            if (!state.availableDays.includes(day)) state.availableDays.push(day);

            // Keep overrides in sync
            if (!state.availabilityConfig.day_overrides) state.availabilityConfig.day_overrides = {};
            state.availabilityConfig.day_overrides[day] = stamped;
        },
        updateMultipleDaySlots: (state, action) => {
            const updates = action.payload;
            if (!state.availabilityConfig.day_overrides) state.availabilityConfig.day_overrides = {};

            Object.keys(updates).forEach(day => {
                const stamped = stampSlots(updates[day]);
                state.availableSlots[day] = stamped;
                if (!state.availableDays.includes(day)) state.availableDays.push(day);

                // Keep overrides in sync
                state.availabilityConfig.day_overrides[day] = stamped;
            });
        },

        // ── UI ───────────────────────────────────────────────────────────
        setActiveTab: (state, action) => { state.activeTab = action.payload; },
        setLoading: (state, action) => { state.loading = action.payload; },
        setError: (state, action) => { state.error = action.payload; },
        setSnackbar: (state, action) => { state.snackbar = action.payload; },
        clearSnackbar: (state) => { state.snackbar.open = false; },
    },
    extraReducers: (builder) => {
        builder
            // Clear entire UI state when user logs out
            .addCase('auth/logout', () => initialPersonalDataState)
            .addCase('auth/logoutUser/fulfilled', () => initialPersonalDataState);
    },
});

export const {
    // Profile
    clearDoctorProfileUiState, setFormData, setFormField, setSlotPricing, populateFormFromProfile,
    // Document data
    setDocumentField, setDocumentData,
    // Female data
    setFemaleField,
    // Communication address
    setCommunicationField, setCommunicationData,
    // Permanent address
    setPermanentAddressField, copyCommToPermanent,
    // Availability config
    setAvailabilityConfig, setAvailabilityField, setWorkingDays,
    setExceptions, toggleException, setApprovalStatus, populateAvailabilityFromSchedule,
    // Legacy calendar
    setAvailability, addAvailableDay, removeAvailableDay,
    updateDaySlots, updateMultipleDaySlots,
    // UI
    setActiveTab, setLoading, setError, setSnackbar, clearSnackbar,
} = doctorProfileUiSlice.actions;

export default doctorProfileUiSlice.reducer;
