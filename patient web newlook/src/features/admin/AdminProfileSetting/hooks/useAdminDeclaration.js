import { useState, useEffect, useCallback, useRef } from 'react';
import {
    useGetAdminMyDeclarationsQuery,
    useUpdateAdminMyDeclarationsMutation,
} from '../../api/adminProfileConfigEndpoints';

const DEFAULT_DECLARATION_STATE = {
    questions: [],
    documentTypes: [],
    selfDeclaration: {
        termsAccepted: false,
        companyPoliciesAccepted: false,
    },
    isSubmitting: false,
};

const useAdminDeclaration = (previewMode = false) => {
    const hasPopulated = useRef(false);

    const [declarationState, setDeclarationState] = useState({ ...DEFAULT_DECLARATION_STATE });

    const {
        data: declData,
    } = useGetAdminMyDeclarationsQuery(undefined, { skip: previewMode });

    const [updateDeclarations] = useUpdateAdminMyDeclarationsMutation();

    // Populate state from fetched data
    useEffect(() => {
        if (previewMode || !declData || hasPopulated.current) return;
        hasPopulated.current = true;

        try {
            const questions = (declData.questions || []).map((q) => ({
                configId: q.configId || q.config_id,
                questionText: q.questionText || q.question_text || '',
                answer: q.answer || '',
                explanation: q.explanation || '',
                attachment: q.attachment
                    ? {
                        file: null,
                        preview: null,
                        fileName: q.attachment.fileName || null,
                        fileUrl: q.attachment.fileUrl || q.attachment.url || null,
                        verificationStatus: q.attachment.verificationStatus || 'pending',
                    }
                    : null,
            }));

            const documentTypes = (declData.documentTypes || []).map((d) => ({
                configId: d.configId || d.config_id,
                documentName: d.documentName || d.document_name || '',
                file: d.file
                    ? {
                        file: null,
                        preview: null,
                        fileName: d.file.fileName || null,
                        fileUrl: d.file.fileUrl || d.file.url || null,
                        verificationStatus: d.file.verificationStatus || 'pending',
                    }
                    : null,
            }));

            const selfDeclaration = declData.selfDeclaration || declData.self_declaration || {
                termsAccepted: false,
                companyPoliciesAccepted: false,
            };

            setDeclarationState((prev) => ({
                ...prev,
                questions,
                documentTypes,
                selfDeclaration: {
                    termsAccepted: selfDeclaration.termsAccepted ?? selfDeclaration.terms_accepted ?? false,
                    companyPoliciesAccepted: selfDeclaration.companyPoliciesAccepted ?? selfDeclaration.company_policies_accepted ?? false,
                },
            }));
        } catch (err) {
            console.error('Failed to populate admin declarations', err);
        }
    }, [declData, previewMode]);

    const handleAnswerChange = useCallback((configId, answer) => {
        setDeclarationState((prev) => ({
            ...prev,
            questions: prev.questions.map((q) =>
                q.configId === configId ? { ...q, answer } : q
            ),
        }));
    }, []);

    const handleExplanationChange = useCallback((configId, explanation) => {
        setDeclarationState((prev) => ({
            ...prev,
            questions: prev.questions.map((q) =>
                q.configId === configId ? { ...q, explanation } : q
            ),
        }));
    }, []);

    const handleAttachmentChange = useCallback((configId, file) => {
        if (!file) {
            setDeclarationState((prev) => ({
                ...prev,
                questions: prev.questions.map((q) =>
                    q.configId === configId ? { ...q, attachment: null } : q
                ),
            }));
            return;
        }
        const preview = URL.createObjectURL(file);
        setDeclarationState((prev) => ({
            ...prev,
            questions: prev.questions.map((q) =>
                q.configId === configId
                    ? {
                        ...q,
                        attachment: {
                            file,
                            preview,
                            fileName: file.name,
                            fileUrl: null,
                            verificationStatus: 'pending',
                        },
                    }
                    : q
            ),
        }));
    }, []);

    const handleDocumentFileChange = useCallback((configId, file) => {
        if (!file) {
            setDeclarationState((prev) => ({
                ...prev,
                documentTypes: prev.documentTypes.map((d) =>
                    d.configId === configId ? { ...d, file: null } : d
                ),
            }));
            return;
        }
        const preview = URL.createObjectURL(file);
        setDeclarationState((prev) => ({
            ...prev,
            documentTypes: prev.documentTypes.map((d) =>
                d.configId === configId
                    ? {
                        ...d,
                        file: {
                            file,
                            preview,
                            fileName: file.name,
                            fileUrl: null,
                            verificationStatus: 'pending',
                        },
                    }
                    : d
            ),
        }));
    }, []);

    const handleSelfDeclarationChange = useCallback((field, value) => {
        setDeclarationState((prev) => ({
            ...prev,
            selfDeclaration: {
                ...prev.selfDeclaration,
                [field]: value,
            },
        }));
    }, []);

    const handleSave = useCallback(async () => {
        setDeclarationState((prev) => ({ ...prev, isSubmitting: true }));
        try {
            const formData = new FormData();

            // Build responses JSON (question answers)
            const responsesData = declarationState.questions.map((q) => ({
                configId: q.configId,
                answer: q.answer,
                explanation: q.explanation || '',
            }));
            formData.append('responses', JSON.stringify(responsesData));

            // Build self-declaration JSON
            formData.append('selfDeclaration', JSON.stringify(declarationState.selfDeclaration));

            // Append question attachment files
            declarationState.questions.forEach((q) => {
                if (q.attachment?.file) {
                    formData.append(`question_${q.configId}_attachment`, q.attachment.file);
                }
            });

            // Append document type files
            declarationState.documentTypes.forEach((d) => {
                if (d.file?.file) {
                    formData.append(`document_${d.configId}_file`, d.file.file);
                }
            });

            await updateDeclarations(formData).unwrap();
            return { success: true, message: 'Declarations submitted for approval!' };
        } catch (err) {
            console.error('Failed to save admin declarations', err);
            return { success: false, message: err?.data?.message || err?.message || 'Failed to save declarations' };
        } finally {
            setDeclarationState((prev) => ({ ...prev, isSubmitting: false }));
        }
    }, [declarationState, updateDeclarations]);

    return {
        declarationState,
        handleAnswerChange,
        handleExplanationChange,
        handleAttachmentChange,
        handleDocumentFileChange,
        handleSelfDeclarationChange,
        handleSave,
    };
};

export default useAdminDeclaration;
