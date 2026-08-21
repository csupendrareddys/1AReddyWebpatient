/**
 * MemberDetail — edit a member's profile (patient|doctor|admin), and act on
 * their behalf where their own app has a surface worth reusing.
 * Route: /dashboard/admin/operations/:memberType/:opType/:memberId/*
 *
 * Patients render the REAL patient pages inside a ``PatientScopeProvider``:
 * ``service-receiver/ProfileSetting`` for the Profile tab, and their own
 * booking screens (consultations, services/products, group health plans,
 * existing bookings) under ``/bookings/*``.
 *
 * Doctors get the same treatment inside a ``DoctorScopeProvider``: the real
 * ``service-provider/ProfileSetting`` page — all of its tabs, including the
 * ones that route edits through the field-approval queue — for the Profile
 * tab, their own "My Appointments / Service List" page under
 * ``/appointments/*``, and their own "Manage Appointments / Services" page
 * under ``/manage``. So everything a patient or a doctor can change about
 * themselves is reachable here too, with one implementation.
 *
 * Two further doctor tabs carry the clinical surfaces — "Prescriptions /
 * Documents" under ``/records/*`` and "Service Chats" under
 * ``/service-chats``. Both read AND write, which makes them the sharpest thing
 * here: a prescription issued or a message sent from them carries the doctor's
 * name to the patient, with only the ops audit log to say an operator did it.
 * Their one exclusion is joining a live call, which the proxy allowlist
 * refuses outright.
 *
 * Clinics and hospitals get a single Profile tab inside a
 * ``FacilityScopeProvider``: their own ``EntityDetailsSection``, which is the
 * whole of what a facility can edit about itself. Verifying, rejecting and
 * suspending one is NOT here — those already have their own admin screen and
 * already take the facility as a path parameter, so they never touch this
 * proxy.
 *
 * Admins still use the flat section editors below; they have no self-service
 * profile page of their own to reuse yet.
 *
 * The route carries a splat because both of those flows are multi-page and
 * need real routes — the tab you're on is read from the URL rather than held
 * in state, so Back works and a reload doesn't drop a half-finished booking.
 * The provider's ``basePath`` tells the reused components where they now live
 * instead of ``/dashboard/patient`` / ``/dashboard/doctor``.
 */
import { lazy, Suspense, useState } from 'react';
import {
    useParams, useNavigate, useLocation, Routes, Route,
} from 'react-router-dom';
import {
    Box, Typography, Paper, Breadcrumbs, Link, Tabs, Tab, Accordion,
    AccordionSummary, AccordionDetails, Grid, TextField, MenuItem, Button,
    CircularProgress, Snackbar, Alert,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import {
    useGetOpsMemberProfileQuery,
    useGetOpsPatientProvenanceQuery,
    useUpdateOpsMemberSectionMutation,
} from '../../api/operationsEndpoints';
import BackButton from '../../../../../common/components/BackButton/BackButton';
import LastUpdatedIndicator from '../../components/LastUpdatedIndicator/LastUpdatedIndicator';
import { PatientScopeProvider } from
    '../../../../service-receiver/ProfileSetting/context/PatientScopeContext';
import { DoctorScopeProvider } from
    '../../../../service-provider/ProfileSetting/context/DoctorScopeContext';
import { FacilityScopeProvider } from
    '../../../../service-provider/EntityProfile/context/FacilityScopeContext';

const PatientProfileSetting = lazy(() => import(
    '../../../../service-receiver/ProfileSetting/pages/ProfileSetting/ProfileSetting'
));
const PatientBookingBox = lazy(() => import(
    '../../components/PatientBookingBox/PatientBookingBox'
));
const DoctorProfileSetting = lazy(() => import(
    '../../../../service-provider/ProfileSetting/pages/ProfileSetting/ProfileSetting'
));
const DoctorOpsBox = lazy(() => import(
    '../../components/DoctorOpsBox/DoctorOpsBox'
));
const DoctorManageBox = lazy(() => import(
    '../../components/DoctorManageBox/DoctorManageBox'
));
const DoctorRecordsBox = lazy(() => import(
    '../../components/DoctorRecordsBox/DoctorRecordsBox'
));
const DoctorChatsBox = lazy(() => import(
    '../../components/DoctorChatsBox/DoctorChatsBox'
));
const FacilityOpsBox = lazy(() => import(
    '../../components/FacilityOpsBox/FacilityOpsBox'
));
const OpsStaffBox = lazy(() => import(
    '../../components/OpsStaffBox/OpsStaffBox'
));

// Per-member-type section/field metadata. `readOnly` fields are shown but not
// editable (and never sent on save). Kept aligned with the backend allowlists.
// Patients and doctors are absent on purpose — they get their own real
// profile pages instead; see the module docstring.
const SECTIONS_BY_TYPE = {
    admin: [
        { key: 'personal-details', title: 'Personal Details', fields: [
            { name: 'first_name', label: 'First name' },
            { name: 'middle_name', label: 'Middle name' },
            { name: 'last_name', label: 'Last name' },
            { name: 'email', label: 'Email', readOnly: true },
            { name: 'phone_number', label: 'Phone', readOnly: true },
            { name: 'role', label: 'Role', readOnly: true },
            { name: 'status', label: 'Status', readOnly: true },
        ] },
    ],
};

const MEMBER_LABEL = {
    patient: 'Patient', doctor: 'Doctor', admin: 'Admin',
    clinic: 'Clinic', hospital: 'Hospital',
};
// Provider facilities. One branch serves both — the models, the scope and the
// single reusable section are identical; only the word differs.
const FACILITY_TYPES = ['clinic', 'hospital'];

function SectionEditor({ memberType, memberId, meta, initial, onSaved }) {
    const [values, setValues] = useState(() => {
        const seed = {};
        meta.fields.forEach((f) => {
            let v = initial?.[f.name];
            if (f.type === 'date' && typeof v === 'string') v = v.slice(0, 10);
            seed[f.name] = v == null ? '' : v;
        });
        return seed;
    });
    const [update, { isLoading }] = useUpdateOpsMemberSectionMutation();
    const set = (name, v) => setValues((s) => ({ ...s, [name]: v }));

    const editableNames = meta.fields.filter((f) => !f.readOnly).map((f) => f.name);
    const hasEditable = editableNames.length > 0;

    const save = async () => {
        const data = Object.fromEntries(
            Object.entries(values).filter(([k, v]) => editableNames.includes(k) && v !== '' && v != null),
        );
        try {
            await update({ memberType, memberId, section: meta.key, data }).unwrap();
            onSaved('success', `${meta.title} saved`);
        } catch (e) {
            onSaved('error', e?.data?.error || `Failed to save ${meta.title}`);
        }
    };

    return (
        <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>{meta.title}</Typography>
            </AccordionSummary>
            <AccordionDetails>
                <Grid container spacing={2}>
                    {meta.fields.map((f) => (
                        <Grid item xs={12} sm={6} key={f.name}>
                            {f.type === 'select' ? (
                                <TextField select fullWidth size="small" label={f.label}
                                    value={values[f.name] || ''} disabled={f.readOnly}
                                    onChange={(e) => set(f.name, e.target.value)}>
                                    <MenuItem value=""><em>—</em></MenuItem>
                                    {f.options.map((o) => (
                                        <MenuItem key={o} value={o}>{o.replace(/_/g, ' ')}</MenuItem>
                                    ))}
                                </TextField>
                            ) : (
                                <TextField fullWidth size="small" label={f.label}
                                    type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                                    InputLabelProps={f.type === 'date' ? { shrink: true } : undefined}
                                    multiline={!!f.multiline} minRows={f.multiline ? 2 : undefined}
                                    disabled={f.readOnly}
                                    value={values[f.name] ?? ''}
                                    onChange={(e) => set(f.name, e.target.value)} />
                            )}
                        </Grid>
                    ))}
                    {hasEditable && (
                        <Grid item xs={12} sx={{ textAlign: 'right' }}>
                            <Button variant="contained" size="small" disabled={isLoading} onClick={save}>
                                {isLoading ? 'Saving…' : `Save ${meta.title}`}
                            </Button>
                        </Grid>
                    )}
                </Grid>
            </AccordionDetails>
        </Accordion>
    );
}

export default function PatientOpsDetail() {
    const { memberType, opType, memberId } = useParams();
    const navigate = useNavigate();
    const { pathname, state } = useLocation();
    const isPatient = memberType === 'patient';
    const isDoctor = memberType === 'doctor';
    const isFacility = FACILITY_TYPES.includes(memberType);

    // These flows are multi-page, so which tab you're on is a URL fact, not
    // component state: Profile at the bare detail route, every other tab under
    // its own segment. That also makes Back work and makes a half-finished
    // booking survive a page reload.
    const detailPath =
        `/dashboard/admin/operations/${memberType}/${opType}/${memberId}`;
    // The patient's booking screens hang off ``/bookings``; the doctor's
    // appointment screens off ``/appointments``, which is also the shape their
    // own app uses, so PatientContextPanel's one URL works in both.
    // Every provider vertical gets a Staff tab. This is the only screen that
    // can CREATE staff, because a staff member belongs to one practice and
    // this is the one place a practice is already chosen — the vertical-wide
    // roster beside the permission matrix has no provider to create them
    // under, so it lists and assigns roles but doesn't add.
    const staffTab = {
        label: 'Staff', base: `${detailPath}/staff`, landing: `${detailPath}/staff`,
    };
    const extraTabs = isDoctor
        ? [
            { label: 'My Appointments / Service List', base: `${detailPath}/appointments`, landing: `${detailPath}/appointments` },
            { label: 'Manage Appointments / Services', base: `${detailPath}/manage`, landing: `${detailPath}/manage` },
            // Same sidebar names the doctor sees. ``records`` carries a splat
            // subtree (the prescription + document form/preview/view pages).
            { label: 'Prescriptions / Documents', base: `${detailPath}/records`, landing: `${detailPath}/records` },
            { label: 'Service Chats', base: `${detailPath}/service-chats`, landing: `${detailPath}/service-chats` },
            staffTab,
        ]
        : isPatient
            ? [{ label: 'Bookings', base: `${detailPath}/bookings`, landing: `${detailPath}/bookings/book-by-type` }]
            : isFacility ? [staffTab] : [];
    // Tab 0 is Profile; the rest follow ``extraTabs`` order.
    const activeExtra = extraTabs.findIndex((t) => pathname.startsWith(t.base));
    const tab = activeExtra === -1 ? 0 : activeExtra + 1;
    const selectTab = (v) => navigate(v === 0 ? detailPath : extraTabs[v - 1].landing);

    const [snack, setSnack] = useState({ open: false, sev: 'success', msg: '' });

    // Patients and doctors get their full profile page instead of these
    // section editors, so the summary fetch is only needed for the breadcrumb
    // name there.
    // Facilities have no ``/profile`` summary endpoint — everything about them
    // is on the EntityProfile the tab itself loads — so the fetch is skipped
    // rather than 404ing, and the breadcrumb falls back to the type name.
    const { data, isFetching } = useGetOpsMemberProfileQuery(
        { memberType, memberId }, { skip: isFacility },
    );
    // Provenance is patient-only and admin-only. Tagged so that a save inside
    // the embedded ProfileSetting refreshes it with no wiring between them.
    const { data: provenance } = useGetOpsPatientProvenanceQuery(memberId, { skip: !isPatient });
    const sections = data?.sections || {};
    // ``state.memberName`` is handed over by the member list, and is the only
    // name a facility has here — see the note on ``open`` in that file.
    const memberName = data?.meta?.member_name || data?.meta?.patient_name
        || state?.memberName || MEMBER_LABEL[memberType] || 'Member';
    const sectionDefs = SECTIONS_BY_TYPE[memberType] || [];

    const notify = (sev, msg) => setSnack({ open: true, sev, msg });

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                {/* The member list this detail page was opened from. History
                    wins when there is any, so arriving via a tab inside the
                    page still steps back one tab at a time. */}
                <BackButton to={`/dashboard/admin/operations/${memberType}/${opType}`} />
                <Typography variant="h5" fontWeight={600}>Operations</Typography>
            </Box>
            <Paper sx={{ mb: 3, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    <Link component="button" underline="hover" color="inherit"
                        onClick={() => navigate('/dashboard/admin/operations')}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <HomeIcon fontSize="small" /> Dashboard
                    </Link>
                    <Link component="button" underline="hover" color="inherit"
                        onClick={() => navigate(`/dashboard/admin/operations/${memberType}/${opType}`)}>
                        {MEMBER_LABEL[memberType] || 'Members'}s
                    </Link>
                    <Typography color="primary" fontWeight="bold">{memberName}</Typography>
                </Breadcrumbs>
                {isPatient && <LastUpdatedIndicator data={provenance} sx={{ mt: 1 }} />}
            </Paper>

            <Paper sx={{ mb: 2 }}>
                <Tabs value={tab} onChange={(_, v) => selectTab(v)}
                    variant="scrollable" scrollButtons="auto">
                    <Tab label="Profile" />
                    {extraTabs.map((t) => <Tab key={t.base} label={t.label} />)}
                </Tabs>
            </Paper>

            {isPatient ? (
                // The patient's own pages, scoped to this patient. Same
                // components, same validation, same prices — writes go through
                // /operations/patients/<id>/act/... instead of /api/patient/...
                // ``basePath`` tells those pages where they now live, so their
                // own navigation stays inside Operations.
                <PatientScopeProvider patientId={memberId} basePath={extraTabs[0].base}>
                    <Suspense fallback={
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    }>
                        <Routes>
                            <Route path="bookings/*" element={<PatientBookingBox />} />
                            <Route path="*" element={<PatientProfileSetting embedded />} />
                        </Routes>
                    </Suspense>
                </PatientScopeProvider>
            ) : isFacility ? (
                // The facility's own entity-details section, scoped to this
                // clinic/hospital — writes go through
                // /operations/<vertical>-members/<id>/act/entity-profile/me
                // instead of /api/entity-profile/me, so the facility's own
                // validation runs and the edit lands on ITS profile row.
                <FacilityScopeProvider facilityId={memberId} vertical={memberType}>
                    <Suspense fallback={
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    }>
                        <Routes>
                            {/* Staff aren't act-on-behalf — they're admin rows
                                about this facility, so they go straight to the
                                provider-rbac endpoints rather than through the
                                proxy. Inside the scope provider anyway, since
                                the tab strip and breadcrumb belong to it. */}
                            <Route path="staff" element={
                                <OpsStaffBox providerType={memberType} providerId={memberId} />
                            } />
                            <Route path="*" element={<FacilityOpsBox vertical={memberType} />} />
                        </Routes>
                    </Suspense>
                </FacilityScopeProvider>
            ) : isDoctor ? (
                // The doctor's own pages, scoped to this doctor — writes go
                // through /operations/doctor-members/<id>/act/... instead of
                // /api/doctor/..., so the field-approval queue, the schedule
                // validation and the bank-account lifecycle all behave exactly
                // as they do for the doctor themselves.
                //
                // ``basePath`` is the detail route rather than a sub-segment
                // because the doctor pages address each other as
                // ``<base>/appointments/...``, matching their own app.
                <DoctorScopeProvider doctorId={memberId} basePath={detailPath}>
                    <Suspense fallback={
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    }>
                        <Routes>
                            <Route path="appointments/*" element={<DoctorOpsBox />} />
                            <Route path="manage" element={<DoctorManageBox />} />
                            <Route path="records/*" element={<DoctorRecordsBox />} />
                            <Route path="service-chats" element={<DoctorChatsBox />} />
                            <Route path="staff" element={
                                <OpsStaffBox providerType="doctor" providerId={memberId} />
                            } />
                            <Route path="*" element={<DoctorProfileSetting />} />
                        </Routes>
                    </Suspense>
                </DoctorScopeProvider>
            ) : tab === 0 && (
                isFetching ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                ) : (
                    <Box>
                        {sectionDefs.map((meta) => (
                            <SectionEditor
                                key={meta.key}
                                memberType={memberType}
                                memberId={memberId}
                                meta={meta}
                                initial={sections[meta.key]}
                                onSaved={notify}
                            />
                        ))}
                    </Box>
                )
            )}

            <Snackbar open={snack.open} autoHideDuration={5000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}>
                <Alert severity={snack.sev} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
                    {snack.msg}
                </Alert>
            </Snackbar>
        </Box>
    );
}
