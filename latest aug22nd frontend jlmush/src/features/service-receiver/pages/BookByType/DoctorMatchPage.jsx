import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Container, Typography, Paper, Grid, Card, CardActionArea,
    CardContent, CircularProgress, Avatar, Chip, IconButton,
    Rating, Button, Pagination, Stack, Badge,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonIcon from '@mui/icons-material/Person';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FilterListIcon from '@mui/icons-material/FilterList';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

import {
    useMatchDoctorsBySymptomsMutation,
    useCreateAppointmentContextMutation,
} from '../../api/scopedBookingApi';
import { CONSULTATION_TYPE_MAP } from '../../../service-provider/ProfileSetting/constants/consultationTypes';
import useBookingFlow from '../../hooks/useBookingFlow';
import usePermissions from '../../../../common/hooks/usePermissions';
import FiltersDialog, { countActiveFilters } from './dialogs/FiltersDialog';
import MemberSelectDialog from './dialogs/MemberSelectDialog';
import SymptomsAndRecordsPage from './SymptomsAndRecordsPage';
import { usePatientScope } from '../../ProfileSetting/context/PatientScopeContext';

const STATUS_COLORS = { red: '#f44336', orange: '#e65100', green: '#4caf50' };

const DoctorMatchPage = () => {
    const {
        consultationType,
        filters,
        selectedSymptoms,
        customSymptoms,
        bookingFor,
        selectedMember,
        medicalContextId,
        handleSelectDoctor,
        handleGoBack,
        setFilters,
        saveBookingFor,
        setMedicalContextId,
    } = useBookingFlow();

    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();
    const canUseIntake = hasFeature('patient.intake_forms');

    const ctMeta = CONSULTATION_TYPE_MAP[consultationType] || {};
    const [page, setPage] = useState(1);

    // Popups
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [memberOpen, setMemberOpen] = useState(false);
    const [symptomsOpen, setSymptomsOpen] = useState(false);

    const [matchDoctors, { data, isLoading, isUninitialized }] = useMatchDoctorsBySymptomsMutation();
    const [createContext, { isLoading: isCreatingCtx }] = useCreateAppointmentContextMutation();

    const symptomIds = useMemo(
        () => (selectedSymptoms || []).map((s) => s.id).filter(Boolean),
        [selectedSymptoms]
    );

    // Ensure a medical context exists (defaults to "self"). The old flow
    // created it on the select-member step; here we create it on landing so
    // symptoms/records saving + the booking `ctx` param have an id to use.
    const contextInitRef = useRef(false);
    useEffect(() => {
        if (!consultationType || medicalContextId || contextInitRef.current) return;
        contextInitRef.current = true;
        createContext({
            consultation_type: consultationType,
            booking_for_id: null,
            house_group_member_id: null,
        })
            .unwrap()
            .then((r) => setMedicalContextId(r.id))
            .catch((err) => {
                contextInitRef.current = false;
                console.error('Failed to create medical context:', err);
            });
    }, [consultationType, medicalContextId, createContext, setMedicalContextId]);

    // Trigger search on mount and whenever filters / symptoms / page change.
    useEffect(() => {
        matchDoctors({
            consultation_type: consultationType,
            symptom_ids: symptomIds,
            custom_symptoms: customSymptoms || [],
            filters: filters || {},
            page,
            per_page: 20,
        });
    }, [matchDoctors, consultationType, symptomIds, customSymptoms, filters, page]);

    const doctors = data?.doctors || [];
    const pagination = data?.pagination || {};

    const activeFilterCount = countActiveFilters(filters || {});
    const symptomCount = symptomIds.length + (Array.isArray(customSymptoms) ? customSymptoms.length : 0);
    const bookingLabel = bookingFor === 'self' || !selectedMember
        ? 'Myself'
        : `${selectedMember.first_name} ${selectedMember.last_name || ''}`.trim();

    // ─── Popup handlers ───
    const handleApplyFilters = (next) => {
        setFilters(next);
        setPage(1);
        setFiltersOpen(false);
    };

    const handleMemberSelected = async (nextBookingFor, member) => {
        // Same selection → nothing to do.
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
        } catch (err) {
            console.error('Failed to create medical context:', err);
        }
        setMemberOpen(false);
    };

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 10 }}>
            {/* Header */}
            <Paper sx={{ p: 3, mb: 2 }}>
                <Box display="flex" alignItems="center" gap={2}>
                    <IconButton onClick={() => handleGoBack(1)}>
                        <ArrowBackIcon />
                    </IconButton>
                    <Box flex={1}>
                        <Typography variant="h5" fontWeight="bold">
                            Matched Doctors
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Doctors available for your consultation
                        </Typography>
                    </Box>
                    <Chip
                        label={ctMeta.label || consultationType}
                        size="small"
                        sx={{
                            bgcolor: `${ctMeta.color || '#666'}20`,
                            color: ctMeta.color || '#666',
                            fontWeight: 600,
                        }}
                    />
                </Box>

                {/* Toolbar: Book for / Filters / Symptoms */}
                <Stack direction="row" spacing={1.5} mt={2} flexWrap="wrap" useFlexGap>
                    <Button
                        variant="outlined"
                        startIcon={<PersonIcon />}
                        endIcon={<KeyboardArrowDownIcon />}
                        onClick={() => setMemberOpen(true)}
                        sx={{ textTransform: 'none' }}
                    >
                        Book for: <strong style={{ marginLeft: 4 }}>{bookingLabel}</strong>
                    </Button>

                    <Badge badgeContent={activeFilterCount} color="primary">
                        <Button
                            variant="outlined"
                            startIcon={<FilterListIcon />}
                            onClick={() => setFiltersOpen(true)}
                            sx={{ textTransform: 'none' }}
                        >
                            Filters
                        </Button>
                    </Badge>

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
            </Paper>

            {/* Results */}
            {(isLoading || isUninitialized) ? (
                <Box display="flex" justifyContent="center" mt={4}>
                    <CircularProgress />
                </Box>
            ) : doctors.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="h6" color="text.secondary">
                        No doctors found matching your criteria
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={1}>
                        Try adjusting your symptoms or filters
                    </Typography>
                    <Button variant="text" onClick={() => setFiltersOpen(true)} sx={{ mt: 2 }}>
                        Change Filters
                    </Button>
                </Paper>
            ) : (
                <>
                    <Grid container spacing={2}>
                        {doctors.map((doc) => {
                            const statusColor = STATUS_COLORS[doc.slot_status] || STATUS_COLORS.orange;
                            const hasSymptomMatch = doc.symptom_match_count > 0;
                            return (
                                <Grid item xs={12} key={doc.id}>
                                    <Card variant="outlined">
                                        <CardActionArea
                                            onClick={() => handleSelectDoctor(doc.id, doc.full_name)}
                                        >
                                            <CardContent>
                                                <Box display="flex" gap={2} alignItems="center">
                                                    <Avatar
                                                        src={doc.profile_image}
                                                        sx={{ width: 56, height: 56, bgcolor: 'primary.main' }}
                                                    >
                                                        <PersonIcon />
                                                    </Avatar>
                                                    <Box flex={1}>
                                                        <Box display="flex" justifyContent="space-between" alignItems="start">
                                                            <Typography variant="subtitle1" fontWeight="bold">
                                                                Dr. {doc.full_name}
                                                            </Typography>
                                                            <Box display="flex" gap={0.5}>
                                                                {hasSymptomMatch && (
                                                                    <Chip
                                                                        icon={<CheckCircleIcon sx={{ fontSize: 14 }} />}
                                                                        label={`${doc.symptom_match_count}/${doc.total_symptoms_searched} match`}
                                                                        size="small"
                                                                        color="success"
                                                                        variant="outlined"
                                                                        sx={{ fontSize: '0.7rem' }}
                                                                    />
                                                                )}
                                                                <Chip
                                                                    icon={<FiberManualRecordIcon sx={{ fontSize: 10, color: `${statusColor} !important` }} />}
                                                                    label={`${doc.available_slots} slots`}
                                                                    size="small"
                                                                    sx={{
                                                                        bgcolor: `${statusColor}15`,
                                                                        color: statusColor,
                                                                        fontWeight: 600,
                                                                        fontSize: '0.7rem',
                                                                    }}
                                                                />
                                                            </Box>
                                                        </Box>
                                                        {doc.specializations?.length > 0 && (
                                                            <Typography variant="body2" color="text.secondary">
                                                                {doc.specializations.join(', ')}
                                                            </Typography>
                                                        )}
                                                        <Box display="flex" gap={2} mt={0.5} flexWrap="wrap">
                                                            {doc.experience_years && (
                                                                <Typography variant="caption" color="text.secondary">
                                                                    {doc.experience_years} yrs exp
                                                                </Typography>
                                                            )}
                                                            {(doc.price_min != null || doc.consultation_fee) && (
                                                                <Typography variant="caption" color="text.secondary">
                                                                    {doc.price_min != null && doc.price_max != null
                                                                        ? doc.price_min === doc.price_max
                                                                            ? `₹${doc.price_min}`
                                                                            : `₹${doc.price_min} – ₹${doc.price_max}`
                                                                        : `From ₹${doc.consultation_fee}`}
                                                                </Typography>
                                                            )}
                                                            {doc.rating && (
                                                                <Box display="flex" alignItems="center" gap={0.5}>
                                                                    <Rating value={doc.rating} precision={0.5} size="small" readOnly />
                                                                    <Typography variant="caption">({doc.total_reviews})</Typography>
                                                                </Box>
                                                            )}
                                                        </Box>
                                                        {doc.languages_known?.length > 0 && (
                                                            <Box display="flex" gap={0.5} mt={0.5} flexWrap="wrap">
                                                                {doc.languages_known.slice(0, 4).map((lang) => (
                                                                    <Chip key={lang} label={lang} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                                                                ))}
                                                                {doc.languages_known.length > 4 && (
                                                                    <Chip label={`+${doc.languages_known.length - 4}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                                                                )}
                                                            </Box>
                                                        )}
                                                        {doc.price_range?.length > 0 && (
                                                            <Box display="flex" gap={0.5} mt={0.5} flexWrap="wrap">
                                                                {doc.price_range.map((tier) => (
                                                                    <Chip
                                                                        key={tier.range}
                                                                        label={`${tier.range} min: ₹${tier.price}${tier.description ? ` — ${tier.description}` : ''}`}
                                                                        size="small"
                                                                        variant="outlined"
                                                                        color="primary"
                                                                        sx={{ fontSize: '0.65rem', height: 22 }}
                                                                    />
                                                                ))}
                                                            </Box>
                                                        )}
                                                    </Box>
                                                </Box>
                                            </CardContent>
                                        </CardActionArea>
                                        <Box sx={{ px: 2, pb: 1.5, pt: 0, display: 'flex', justifyContent: 'flex-end' }}>
                                            <Button
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigate(`${basePath}/doctor/${doc.id}`);
                                                }}
                                                sx={{ textTransform: 'none' }}
                                            >
                                                View Profile
                                            </Button>
                                        </Box>
                                    </Card>
                                </Grid>
                            );
                        })}
                    </Grid>

                    {pagination.pages > 1 && (
                        <Box display="flex" justifyContent="center" mt={3}>
                            <Pagination
                                count={pagination.pages}
                                page={page}
                                onChange={(_, p) => setPage(p)}
                                color="primary"
                            />
                        </Box>
                    )}
                </>
            )}

            {/* ─── Popups ─── */}
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
                    onSaved={() => setPage(1)}
                />
            )}
        </Container>
    );
};

export default DoctorMatchPage;
