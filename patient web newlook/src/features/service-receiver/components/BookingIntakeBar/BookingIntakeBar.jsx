/**
 * BookingIntakeBar — the "collect this information" card shown before booking
 * ANY service or consultation: **Book for** (who the booking is for),
 * **Preferences**, and **Fill health records** (symptoms + medical records).
 *
 * The type-first consultation flow already renders these three controls inside
 * DoctorMatchPage. This component is the same card, made reusable so the
 * doctor-first consultation flow, the Services (marketplace) flow, and the
 * Health Plans (group offering) flow all collect the same intake — the piece
 * that "wasn't shown when the doctor itself was selected".
 *
 * It drives the shared bookingFlow slice (so it can reuse the existing dialogs,
 * including the large SymptomsAndRecordsPage), materialises an
 * AppointmentMedicalContext, and hands its id back via ``onContextReady`` so
 * the parent can link it to whatever booking it creates.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
    Paper, Box, Stack, Button, Badge, Typography,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import FilterListIcon from '@mui/icons-material/FilterList';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';

import { useCreateAppointmentContextMutation } from '../../api/scopedBookingApi';
import useBookingFlow from '../../hooks/useBookingFlow';
import usePermissions from '../../../../common/hooks/usePermissions';
import {
    resetBookingFlow, setConsultationType,
} from '../../redux/bookingFlowSlice';
import FiltersDialog, { countActiveFilters } from '../../pages/BookByType/dialogs/FiltersDialog';
import MemberSelectDialog from '../../pages/BookByType/dialogs/MemberSelectDialog';
import SymptomsAndRecordsPage from '../../pages/BookByType/SymptomsAndRecordsPage';

export default function BookingIntakeBar({
    consultationType = 'general',
    existingContextId = null,
    // A stable key for one booking session. When it changes (and no
    // existingContextId is supplied) a fresh context is minted so a previous
    // booking's intake never leaks into a new one.
    freshKey = null,
    showFilters = true,
    title = 'Before you book — share your details',
    subtitle = 'Tell us who this is for and share any health records so your provider is prepared.',
    onContextReady,
}) {
    const dispatch = useDispatch();
    const { hasFeature } = usePermissions();
    const canUseIntake = hasFeature('patient.intake_forms');

    const {
        filters, selectedSymptoms, customSymptoms, bookingFor, selectedMember,
        medicalContextId, setFilters, saveBookingFor, setMedicalContextId,
    } = useBookingFlow();

    const [createContext, { isLoading: isCreatingCtx }] = useCreateAppointmentContextMutation();

    const [filtersOpen, setFiltersOpen] = useState(false);
    const [memberOpen, setMemberOpen] = useState(false);
    const [symptomsOpen, setSymptomsOpen] = useState(false);

    // Initialise the context once per booking session (keyed so a new
    // doctor/offering starts clean).
    const initKeyRef = useRef(null);
    useEffect(() => {
        const key = existingContextId || freshKey || `intake:${consultationType}`;
        if (initKeyRef.current === key) return;
        initKeyRef.current = key;

        if (existingContextId) {
            // Adopt a context created earlier in the flow (e.g. the type-first
            // DoctorMatchPage already collected intake into it).
            dispatch(setConsultationType(consultationType));
            setMedicalContextId(existingContextId);
            onContextReady?.(existingContextId);
            return;
        }
        // Fresh booking → clear any stale flow state and mint a new context.
        dispatch(resetBookingFlow());
        dispatch(setConsultationType(consultationType));
        createContext({
            consultation_type: consultationType,
            booking_for_id: null,
            house_group_member_id: null,
        })
            .unwrap()
            .then((r) => {
                setMedicalContextId(r.id);
                onContextReady?.(r.id);
            })
            .catch((err) => {
                initKeyRef.current = null;
                // eslint-disable-next-line no-console
                console.error('Failed to create medical context:', err);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingContextId, freshKey, consultationType]);

    const activeFilterCount = countActiveFilters(filters || {});
    const symptomCount = (selectedSymptoms || []).length
        + (Array.isArray(customSymptoms) ? customSymptoms.length : 0);
    const bookingLabel = bookingFor === 'self' || !selectedMember
        ? 'Myself'
        : `${selectedMember.first_name} ${selectedMember.last_name || ''}`.trim();

    const handleApplyFilters = (next) => {
        setFilters(next);
        setFiltersOpen(false);
    };

    const handleMemberSelected = async (nextBookingFor, member) => {
        if (nextBookingFor === bookingFor && medicalContextId) {
            setMemberOpen(false);
            return;
        }
        try {
            const r = await createContext({
                consultation_type: consultationType,
                booking_for_id: member?.linked_patient_id || null,
                house_group_member_id: member?.member_id || null,
            }).unwrap();
            setMedicalContextId(r.id);
            saveBookingFor(nextBookingFor, member);
            onContextReady?.(r.id);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to create medical context:', err);
        }
        setMemberOpen(false);
    };

    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <AssignmentIndIcon color="primary" fontSize="small" />
                <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
            </Stack>
            {subtitle && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {subtitle}
                </Typography>
            )}

            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <Button
                    variant="outlined"
                    startIcon={<PersonIcon />}
                    endIcon={<KeyboardArrowDownIcon />}
                    onClick={() => setMemberOpen(true)}
                    sx={{ textTransform: 'none' }}
                >
                    Book for: <strong style={{ marginLeft: 4 }}>{bookingLabel}</strong>
                </Button>

                {showFilters && (
                    <Badge badgeContent={activeFilterCount} color="primary">
                        <Button
                            variant="outlined"
                            startIcon={<FilterListIcon />}
                            onClick={() => setFiltersOpen(true)}
                            sx={{ textTransform: 'none' }}
                        >
                            Preferences
                        </Button>
                    </Badge>
                )}

                {canUseIntake && (
                    <Badge badgeContent={symptomCount} color="secondary">
                        <Button
                            variant="outlined"
                            startIcon={<HealthAndSafetyIcon />}
                            onClick={() => setSymptomsOpen(true)}
                            sx={{ textTransform: 'none' }}
                        >
                            Symptoms / Medical Records
                        </Button>
                    </Badge>
                )}
            </Stack>

            {/* Dialogs */}
            <FiltersDialog
                open={filtersOpen}
                onClose={() => setFiltersOpen(false)}
                initialFilters={filters}
                onApply={handleApplyFilters}
            />

            <MemberSelectDialog
                open={memberOpen}
                onClose={() => setMemberOpen(false)}
                currentBookingFor={bookingFor}
                onSelect={handleMemberSelected}
                isCreating={isCreatingCtx}
            />

            {canUseIntake && symptomsOpen && (
                <SymptomsAndRecordsPage
                    asDialog
                    open={symptomsOpen}
                    onClose={() => setSymptomsOpen(false)}
                    onSaved={() => { /* stays on this page — nothing to advance */ }}
                />
            )}
        </Paper>
    );
}
