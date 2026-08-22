import { useState, useEffect, useCallback, useRef } from 'react';
import {
    useGetAdminMySignaturesQuery,
    useUpdateAdminMySignaturesMutation,
} from '../../api/adminProfileConfigEndpoints';

const DEFAULT_SIGNATURE_ENTRY = {
    file: null,
    preview: null,
    fileName: null,
    fileUrl: null,
    verificationStatus: 'pending',
};

const DEFAULT_SIGNATURES_STATE = {
    signature1: { ...DEFAULT_SIGNATURE_ENTRY },
    signature2: { ...DEFAULT_SIGNATURE_ENTRY },
    digitalSignature: { ...DEFAULT_SIGNATURE_ENTRY },
    isSubmitting: false,
};

const useAdminSignatures = (previewMode = false) => {
    const hasPopulated = useRef(false);

    const [signaturesState, setSignaturesState] = useState({ ...DEFAULT_SIGNATURES_STATE });

    const {
        data: sigData,
    } = useGetAdminMySignaturesQuery(undefined, { skip: previewMode });

    const [updateSignatures] = useUpdateAdminMySignaturesMutation();

    // Populate state from fetched data
    useEffect(() => {
        if (previewMode || !sigData || hasPopulated.current) return;
        hasPopulated.current = true;

        try {
            const mapSig = (raw) => ({
                file: null,
                preview: null,
                fileName: raw?.fileName || null,
                fileUrl: raw?.fileUrl || raw?.url || null,
                verificationStatus: raw?.verificationStatus || 'pending',
            });

            setSignaturesState((prev) => ({
                ...prev,
                signature1: sigData.signature1 ? mapSig(sigData.signature1) : { ...DEFAULT_SIGNATURE_ENTRY },
                signature2: sigData.signature2 ? mapSig(sigData.signature2) : { ...DEFAULT_SIGNATURE_ENTRY },
                digitalSignature: sigData.digitalSignature ? mapSig(sigData.digitalSignature) : { ...DEFAULT_SIGNATURE_ENTRY },
            }));
        } catch (err) {
            console.error('Failed to populate admin signatures', err);
        }
    }, [sigData, previewMode]);

    const handleSignatureFileChange = useCallback((key, file) => {
        if (!file) {
            setSignaturesState((prev) => ({
                ...prev,
                [key]: { ...DEFAULT_SIGNATURE_ENTRY },
            }));
            return;
        }
        const preview = URL.createObjectURL(file);
        setSignaturesState((prev) => ({
            ...prev,
            [key]: {
                ...prev[key],
                file,
                preview,
                fileName: file.name,
            },
        }));
    }, []);

    const handleRemoveSignature = useCallback((key) => {
        setSignaturesState((prev) => ({
            ...prev,
            [key]: { ...DEFAULT_SIGNATURE_ENTRY },
        }));
    }, []);

    const handleSaveSignatures = useCallback(async () => {
        const { signature1, signature2, digitalSignature } = signaturesState;

        const hasNewFile = signature1.file || signature2.file || digitalSignature.file;
        if (!hasNewFile) {
            return { success: false, message: 'Please select at least one signature image to upload.' };
        }

        setSignaturesState((prev) => ({ ...prev, isSubmitting: true }));
        try {
            const formData = new FormData();

            if (signature1.file) formData.append('signature1', signature1.file);
            if (signature2.file) formData.append('signature2', signature2.file);
            if (digitalSignature.file) formData.append('digitalSignature', digitalSignature.file);

            await updateSignatures(formData).unwrap();
            return { success: true, message: 'Signatures submitted for verification!' };
        } catch (err) {
            console.error('Failed to save admin signatures', err);
            return { success: false, message: err?.data?.message || err?.message || 'Failed to submit signatures' };
        } finally {
            setSignaturesState((prev) => ({ ...prev, isSubmitting: false }));
        }
    }, [signaturesState, updateSignatures]);

    return {
        signaturesState,
        handleSignatureFileChange,
        handleRemoveSignature,
        handleSaveSignatures,
    };
};

export default useAdminSignatures;
