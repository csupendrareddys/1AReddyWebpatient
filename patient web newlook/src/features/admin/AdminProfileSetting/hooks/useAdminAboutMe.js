import { useState, useEffect, useCallback, useRef } from 'react';
import {
    useGetAdminMyAboutQuery,
    useUpdateAdminMyAboutMutation,
} from '../../api/adminProfileConfigEndpoints';

const DEFAULT_ABOUT_ENTRY = {
    text: '',
    attachment: null,
    attachmentUrl: null,
    preview: null,
    attachmentName: null,
    verificationStatus: 'pending',
};

const DEFAULT_ABOUT_STATE = {
    briefAbout: { ...DEFAULT_ABOUT_ENTRY },
    natureOfWork: { ...DEFAULT_ABOUT_ENTRY },
    currentlyWorkingWith: { ...DEFAULT_ABOUT_ENTRY },
    isSubmitting: false,
};

const useAdminAboutMe = (previewMode = false) => {
    const hasPopulated = useRef(false);

    const [aboutState, setAboutState] = useState({ ...DEFAULT_ABOUT_STATE });

    const {
        data: aboutData,
    } = useGetAdminMyAboutQuery(undefined, { skip: previewMode });

    const [updateAbout] = useUpdateAdminMyAboutMutation();

    // Populate state from fetched data
    useEffect(() => {
        if (previewMode || !aboutData || hasPopulated.current) return;
        hasPopulated.current = true;

        try {
            const mapField = (raw) => ({
                text: raw?.text || '',
                attachment: null,
                attachmentUrl: raw?.attachmentUrl || raw?.url || null,
                preview: null,
                attachmentName: raw?.attachmentName || raw?.fileName || null,
                verificationStatus: raw?.verificationStatus || 'pending',
            });

            setAboutState((prev) => ({
                ...prev,
                briefAbout: aboutData.briefAbout ? mapField(aboutData.briefAbout) : { ...DEFAULT_ABOUT_ENTRY },
                natureOfWork: aboutData.natureOfWork ? mapField(aboutData.natureOfWork) : { ...DEFAULT_ABOUT_ENTRY },
                currentlyWorkingWith: aboutData.currentlyWorkingWith ? mapField(aboutData.currentlyWorkingWith) : { ...DEFAULT_ABOUT_ENTRY },
            }));
        } catch (err) {
            console.error('Failed to populate admin about data', err);
        }
    }, [aboutData, previewMode]);

    const handleAboutTextChange = useCallback((field, text) => {
        setAboutState((prev) => ({
            ...prev,
            [field]: { ...prev[field], text },
        }));
    }, []);

    const handleAboutAttachmentChange = useCallback((field, file) => {
        if (!file) {
            setAboutState((prev) => ({
                ...prev,
                [field]: {
                    ...prev[field],
                    attachment: null,
                    preview: null,
                    attachmentName: null,
                },
            }));
            return;
        }
        const preview = URL.createObjectURL(file);
        setAboutState((prev) => ({
            ...prev,
            [field]: {
                ...prev[field],
                attachment: file,
                preview,
                attachmentName: file.name,
            },
        }));
    }, []);

    const handleRemoveAboutAttachment = useCallback((field) => {
        setAboutState((prev) => ({
            ...prev,
            [field]: {
                ...prev[field],
                attachment: null,
                preview: null,
                attachmentName: null,
                attachmentUrl: null,
            },
        }));
    }, []);

    const handleSaveAbout = useCallback(async () => {
        setAboutState((prev) => ({ ...prev, isSubmitting: true }));
        try {
            const formData = new FormData();
            const { briefAbout, natureOfWork, currentlyWorkingWith } = aboutState;

            formData.append('briefAbout', briefAbout.text || '');
            formData.append('natureOfWork', natureOfWork.text || '');
            formData.append('currentlyWorkingWith', currentlyWorkingWith.text || '');

            if (briefAbout.attachment) formData.append('briefAboutAttachment', briefAbout.attachment);
            if (natureOfWork.attachment) formData.append('natureOfWorkAttachment', natureOfWork.attachment);
            if (currentlyWorkingWith.attachment) formData.append('currentlyWorkingWithAttachment', currentlyWorkingWith.attachment);

            await updateAbout(formData).unwrap();
            return { success: true, message: 'About information submitted for approval!' };
        } catch (err) {
            console.error('Failed to save admin about info', err);
            return { success: false, message: err?.data?.message || err?.message || 'Failed to save about info' };
        } finally {
            setAboutState((prev) => ({ ...prev, isSubmitting: false }));
        }
    }, [aboutState, updateAbout]);

    return {
        aboutState,
        handleAboutTextChange,
        handleAboutAttachmentChange,
        handleRemoveAboutAttachment,
        handleSaveAbout,
    };
};

export default useAdminAboutMe;
