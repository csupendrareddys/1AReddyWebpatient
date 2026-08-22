/**
 * FacilityOpsBox — a clinic's or hospital's own profile, mounted inside the
 * admin Operations detail page and pointed at one specific facility.
 *
 * Same bargain as the patient and doctor tabs: rather than an admin-only form
 * that drifts from the real one, this renders the actual
 * ``EntityDetailsSection`` — the section a clinic or hospital sees on its own
 * ``/dashboard/<vertical>/settings`` page — with the facility scope
 * re-pointing its two requests at the act-on-behalf proxy. Whatever an
 * operator saves here is exactly what the facility would have saved.
 *
 * Why this is the whole tab. A facility's editable identity IS its
 * EntityProfile: entity type, legal and trade name, promoters, year, and the
 * registration / CIN / GST / PAN numbers. The other things an admin does to a
 * clinic — verify, reject, suspend the owner's login, re-invite — already have
 * their own screen under "View Clinics" / "View Hospitals" and already take
 * the facility as a path parameter, so they neither need nor use this proxy.
 * Duplicating them here would be the drift the whole module exists to avoid.
 *
 * The facility's ``/settings`` route also mounts seven doctor tabs beside this
 * section, but a clinic account has no Doctor row, so those tabs 404 for the
 * facility itself. Mounting only the section that works is the honest subset —
 * not a limitation of Operations.
 *
 * Save wiring mirrors ``ManageAppointmentsServices``: the section registers a
 * handler and the footer button drives it, because the section is built to sit
 * under ``ProfileSetting``'s sticky footer rather than own a button.
 */
import { lazy, Suspense, useCallback, useState } from 'react';
import {
    Box, Button, CircularProgress, Alert, Paper,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

const EntityDetailsSection = lazy(() => import(
    '../../../../service-provider/EntityProfile/sections/EntityDetailsSection'));

const Loading = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
    </Box>
);

const LABEL = { clinic: 'clinic', hospital: 'hospital' };

export default function FacilityOpsBox({ vertical }) {
    const [saveInfo, setSaveInfo] = useState({
        handler: null, label: 'Save Entity Details', disabled: false,
    });
    const registerSave = useCallback((handler, label, disabled) => {
        setSaveInfo({ handler, label: label || 'Save', disabled: !!disabled });
    }, []);

    const noun = LABEL[vertical] || 'facility';

    return (
        <>
            <Alert severity="info" sx={{ mb: 2 }}>
                You&apos;re acting <b>on this {noun}&apos;s behalf</b> — these are its own
                entity details, and a change saved here is recorded as the {noun}&apos;s.
                Verification, account status and re-invites live under
                <b> View {noun === 'clinic' ? 'Clinics' : 'Hospitals'}</b>, not here.
            </Alert>
            <Paper sx={{ p: 3, borderRadius: 2 }}>
                <Suspense fallback={<Loading />}>
                    <EntityDetailsSection registerSave={registerSave} />
                </Suspense>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
                    <Button
                        variant="contained"
                        startIcon={<SaveIcon />}
                        onClick={() => saveInfo.handler && saveInfo.handler()}
                        disabled={saveInfo.disabled}
                        sx={{ px: 4 }}
                    >
                        {saveInfo.label}
                    </Button>
                </Box>
            </Paper>
        </>
    );
}
