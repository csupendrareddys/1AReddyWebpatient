import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorSignatures,
    submitDoctorSignatures,
} from '../../redux/doctorSlice';
import {
    setSignatureFile,
    removeSignatureFile,
    populateSignaturesFromProfile,
    setSignaturesSubmitting,
} from '../redux/doctorProfileSignaturesSlice';
import { setSnackbar } from '../redux/doctorProfilePersonalDetailsSlice';
import PREVIEW_SAMPLE_DATA from '../constants/previewSampleData';

const useSignatures = (previewMode = false) => {
    const dispatch = useDispatch();

    const signaturesState = useSelector((state) =>
        state.doctorProfileSignatures || PREVIEW_SAMPLE_DATA.signaturesState
    );

    const resolvedSignatures = previewMode ? PREVIEW_SAMPLE_DATA.signaturesState : signaturesState;

    // Fetch signatures on mount
    useEffect(() => {
        if (previewMode) return;
        const load = async () => {
            try {
                const sigResult = await dispatch(fetchDoctorSignatures()).unwrap();
                if (sigResult) dispatch(populateSignaturesFromProfile(sigResult));
            } catch (_) { /* signatures may not exist yet */ }
        };
        load();
    }, [dispatch, previewMode]);

    const handleSignatureFileChange = useCallback((key, file) => {
        if (!file) {
            dispatch(removeSignatureFile(key));
            return;
        }
        const preview = URL.createObjectURL(file);
        dispatch(setSignatureFile({
            key,
            data: { file, preview, fileName: file.name },
        }));
    }, [dispatch]);

    const handleRemoveSignature = useCallback((key) => {
        dispatch(removeSignatureFile(key));
    }, [dispatch]);

    const handleSaveSignatures = useCallback(async () => {
        const { signature1, signature2, digitalSignature } = resolvedSignatures;

        const hasNewFile = signature1.file || signature2.file || digitalSignature.file;
        if (!hasNewFile) {
            dispatch(setSnackbar({ open: true, message: 'Please select at least one signature image to upload.', severity: 'warning' }));
            return;
        }

        dispatch(setSignaturesSubmitting(true));
        try {
            const formData = new FormData();

            if (signature1.file) formData.append('signature1', signature1.file);
            if (signature2.file) formData.append('signature2', signature2.file);
            if (digitalSignature.file) formData.append('digitalSignature', digitalSignature.file);

            const result = await dispatch(submitDoctorSignatures(formData)).unwrap();
            if (result) dispatch(populateSignaturesFromProfile(result));
            dispatch(setSnackbar({ open: true, message: 'Signatures submitted for admin verification!', severity: 'success' }));
        } catch (err) {
            dispatch(setSnackbar({ open: true, message: err.message || err || 'Failed to submit signatures', severity: 'error' }));
        } finally {
            dispatch(setSignaturesSubmitting(false));
        }
    }, [dispatch, resolvedSignatures]);

    return {
        signaturesState: resolvedSignatures,
        handleSignatureFileChange,
        handleRemoveSignature,
        handleSaveSignatures,
    };
};

export default useSignatures;
