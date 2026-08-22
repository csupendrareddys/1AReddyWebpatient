import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorDeclarations,
    submitDoctorDeclarations,
} from '../../redux/doctorSlice';
import {
    setDeclarationAnswer,
    setDeclarationExplanation,
    setDeclarationAttachment,
    removeDeclarationAttachment,
    setDocumentFile,
    removeDocumentFile,
    setSelfDeclaration,
    populateDeclarationsFromProfile,
    setDeclarationSubmitting,
} from '../redux/doctorProfileDeclarationSlice';
import { setSnackbar } from '../redux/doctorProfilePersonalDetailsSlice';
import PREVIEW_SAMPLE_DATA from '../constants/previewSampleData';

const useDeclaration = (previewMode = false) => {
    const dispatch = useDispatch();

    const declarationState = useSelector((state) =>
        state.doctorProfileDeclaration || PREVIEW_SAMPLE_DATA.declarationState
    );

    const resolved = previewMode ? PREVIEW_SAMPLE_DATA.declarationState : declarationState;

    // Fetch declarations + config on mount
    useEffect(() => {
        if (previewMode) return;
        const load = async () => {
            try {
                const result = await dispatch(fetchDoctorDeclarations()).unwrap();
                if (result) dispatch(populateDeclarationsFromProfile(result));
            } catch (_) { /* declarations may not be configured yet */ }
        };
        load();
    }, [dispatch, previewMode]);

    const handleAnswerChange = useCallback((configId, answer) => {
        dispatch(setDeclarationAnswer({ configId, answer }));
    }, [dispatch]);

    const handleExplanationChange = useCallback((configId, explanation) => {
        dispatch(setDeclarationExplanation({ configId, explanation }));
    }, [dispatch]);

    const handleAttachmentChange = useCallback((configId, file) => {
        if (!file) {
            dispatch(removeDeclarationAttachment({ configId }));
            return;
        }
        const preview = URL.createObjectURL(file);
        dispatch(setDeclarationAttachment({
            configId,
            data: { file, preview, fileName: file.name },
        }));
    }, [dispatch]);

    const handleDocumentFileChange = useCallback((configId, file) => {
        if (!file) {
            dispatch(removeDocumentFile({ configId }));
            return;
        }
        const preview = URL.createObjectURL(file);
        dispatch(setDocumentFile({
            configId,
            data: { file, preview, fileName: file.name },
        }));
    }, [dispatch]);

    const handleSelfDeclarationChange = useCallback((field, value) => {
        dispatch(setSelfDeclaration({ field, value }));
    }, [dispatch]);

    const handleSave = useCallback(async () => {
        dispatch(setDeclarationSubmitting(true));
        try {
            const formData = new FormData();

            // Build responses JSON (question answers)
            const responsesData = resolved.questions.map((q) => ({
                configId: q.configId,
                answer: q.answer,
                explanation: q.explanation || '',
            }));
            formData.append('responses', JSON.stringify(responsesData));

            // Build self-declaration JSON
            formData.append('selfDeclaration', JSON.stringify(resolved.selfDeclaration));

            // Append question attachment files
            resolved.questions.forEach((q) => {
                if (q.attachment?.file) {
                    formData.append(`question_${q.configId}_attachment`, q.attachment.file);
                }
            });

            // Append document type files
            resolved.documentTypes.forEach((d) => {
                if (d.file?.file) {
                    formData.append(`document_${d.configId}_file`, d.file.file);
                }
            });

            const result = await dispatch(submitDoctorDeclarations(formData)).unwrap();
            if (result) dispatch(populateDeclarationsFromProfile(result));
            dispatch(setSnackbar({
                open: true,
                message: 'Declarations saved! Pending admin verification.',
                severity: 'success',
            }));
        } catch (err) {
            dispatch(setSnackbar({
                open: true,
                message: err?.message || err || 'Failed to save declarations',
                severity: 'error',
            }));
        } finally {
            dispatch(setDeclarationSubmitting(false));
        }
    }, [dispatch, resolved]);

    return {
        declarationState: resolved,
        handleAnswerChange,
        handleExplanationChange,
        handleAttachmentChange,
        handleDocumentFileChange,
        handleSelfDeclarationChange,
        handleSave,
    };
};

export default useDeclaration;
