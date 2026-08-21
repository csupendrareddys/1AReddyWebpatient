import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import {
    setConsultationType,
    applyFilters,
    setFilters,
    setBookingFor,
    setMedicalContextId,
    setSelectedSymptoms,
    setCustomSymptoms,
    setAdditionalDetails,
    setAdditionalVitals,
    setSharingToggles,
    setSectionVisibility,
    completeSymptomsAndRecords,
    selectDoctor,
    goToStep,
    resetBookingFlow,
} from '../redux/bookingFlowSlice';
import { usePatientScope } from '../ProfileSetting/context/PatientScopeContext';

/**
 * Flow (popup-driven):
 * 1 = ConsultationTypeLanding       /book-by-type
 * 2 = DoctorMatchPage               /book-by-type/:type
 *       ├─ Book-for popup   (member selection)
 *       ├─ Filters popup     (doctor preferences)
 *       └─ Symptoms popup    (symptoms + medical records)
 *   → existing BookAppointment      /book/:doctorId/:consultationType?ctx=<id>
 *
 * The old standalone step pages (DoctorFilterPage / FamilyMemberSelection /
 * SymptomsAndRecordsPage-as-page) have been folded into popups on the match
 * page; the navigating handlers below are kept only for backwards
 * compatibility and are no longer part of the active flow.
 */
export default function useBookingFlow() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { consultationType: urlConsultationType } = useParams();
    const flow = useSelector((state) => state.bookingFlow);
    // Where this flow lives: the patient's own dashboard, or the Operations
    // member-detail route when a super-admin is booking on their behalf.
    const { basePath } = usePatientScope();
    const BASE = `${basePath}/book-by-type`;

    const consultationType = urlConsultationType || flow.selectedConsultationType;

    // Step 1 → 2: start a fresh booking for this type and land directly on
    // the matched-doctors page. Reset first so a previous booking's medical
    // context / filters / symptoms don't leak into the new one.
    const handleSelectConsultationType = useCallback((type) => {
        dispatch(resetBookingFlow());
        dispatch(setConsultationType(type));
        navigate(`${BASE}/${type}`);
    }, [dispatch, navigate, BASE]);

    // Popup save helpers (no navigation — used by the match-page dialogs).
    const saveBookingFor = useCallback((bookingFor, member) => {
        dispatch(setBookingFor({ bookingFor, member }));
    }, [dispatch]);

    const saveSymptoms = useCallback((symptoms, custom) => {
        dispatch(setSelectedSymptoms(symptoms));
        dispatch(setCustomSymptoms(custom));
    }, [dispatch]);

    // Step 2 → 3: apply filters and move to family member selection
    const handleApplyFilters = useCallback((filters) => {
        dispatch(applyFilters(filters));
        navigate(`${BASE}/${consultationType}/select-member`);
    }, [dispatch, navigate, BASE, consultationType]);

    // Step 3 → 4: go to combined symptoms + records page
    const handleSelectMember = useCallback((bookingFor, member) => {
        dispatch(setBookingFor({ bookingFor, member }));
        navigate(`${BASE}/${consultationType}/symptoms-and-records`);
    }, [dispatch, navigate, BASE, consultationType]);

    // Step 4 → 5: symptoms + records done, go to doctor match
    const handleCompleteSymptomsAndRecords = useCallback((symptoms, custom) => {
        dispatch(setSelectedSymptoms(symptoms));
        dispatch(setCustomSymptoms(custom));
        dispatch(completeSymptomsAndRecords());
        navigate(`${BASE}/${consultationType}/doctors`);
    }, [dispatch, navigate, BASE, consultationType]);

    // Step 5 → existing booking: doctor selected, go to slot booking
    const handleSelectDoctor = useCallback((doctorId, doctorName) => {
        dispatch(selectDoctor({ doctorId, doctorName }));
        const ctxParam = flow.medicalContextId ? `?ctx=${flow.medicalContextId}` : '';
        navigate(`${basePath}/book/${doctorId}/${consultationType}${ctxParam}`);
    }, [dispatch, navigate, basePath, flow.medicalContextId, consultationType]);

    const handleGoBack = useCallback((step) => {
        dispatch(goToStep(step));
        switch (step) {
            case 1:
                navigate(BASE);
                break;
            case 2:
                navigate(`${BASE}/${consultationType}`);
                break;
            case 3:
                navigate(`${BASE}/${consultationType}/select-member`);
                break;
            case 4:
                navigate(`${BASE}/${consultationType}/symptoms-and-records`);
                break;
            case 5:
                navigate(`${BASE}/${consultationType}/doctors`);
                break;
            default:
                navigate(BASE);
        }
    }, [dispatch, navigate, BASE, consultationType]);

    const handleReset = useCallback(() => {
        dispatch(resetBookingFlow());
        navigate(BASE);
    }, [dispatch, navigate, BASE]);

    return {
        ...flow,
        consultationType,
        handleSelectConsultationType,
        handleApplyFilters,
        handleSelectDoctor,
        handleSelectMember,
        handleCompleteSymptomsAndRecords,
        saveBookingFor,
        saveSymptoms,
        handleGoBack,
        handleReset,
        setMedicalContextId: (id) => dispatch(setMedicalContextId(id)),
        setFilters: (f) => dispatch(setFilters(f)),
        setAdditionalDetails: (d) => dispatch(setAdditionalDetails(d)),
        setAdditionalVitals: (v) => dispatch(setAdditionalVitals(v)),
        persistSharingToggles: (t) => dispatch(setSharingToggles(t)),
        persistSectionVisibility: (v) => dispatch(setSectionVisibility(v)),
    };
}
