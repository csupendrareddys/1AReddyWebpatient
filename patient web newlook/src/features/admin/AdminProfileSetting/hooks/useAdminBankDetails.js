import { useState, useEffect, useCallback, useRef } from 'react';
import {
    useGetAdminMyBankAccountsQuery,
    useUpdateAdminMyBankAccountsMutation,
} from '../../api/adminProfileConfigEndpoints';

const DEFAULT_FILE_ENTRY = {
    file: null,
    preview: null,
    fileName: null,
    fileUrl: null,
    verificationStatus: 'pending',
};

const createDefaultAccount = (orderIndex = 0) => ({
    orderIndex,
    bankName: '',
    accountName: '',
    accountNumber: '',
    ifscCode: '',
    branch: '',
    passbook: { ...DEFAULT_FILE_ENTRY },
    checkLeaf: { ...DEFAULT_FILE_ENTRY },
    bankStatement: { ...DEFAULT_FILE_ENTRY },
});

const DEFAULT_BANK_STATE = {
    accounts: [createDefaultAccount(0)],
    isSubmitting: false,
};

const useAdminBankDetails = (previewMode = false) => {
    const hasPopulated = useRef(false);

    const [bankState, setBankState] = useState({ ...DEFAULT_BANK_STATE });

    const {
        data: bankData,
    } = useGetAdminMyBankAccountsQuery(undefined, { skip: previewMode });

    const [updateBankAccounts] = useUpdateAdminMyBankAccountsMutation();

    // Populate state from fetched data
    useEffect(() => {
        if (previewMode || !bankData || hasPopulated.current) return;
        hasPopulated.current = true;

        try {
            const accounts = bankData.accounts || bankData;
            if (Array.isArray(accounts) && accounts.length > 0) {
                const mapFileEntry = (raw) => ({
                    file: null,
                    preview: null,
                    fileName: raw?.fileName || null,
                    fileUrl: raw?.fileUrl || raw?.url || null,
                    verificationStatus: raw?.verificationStatus || 'pending',
                });

                const mappedAccounts = accounts.map((a, i) => ({
                    orderIndex: a.orderIndex ?? i,
                    bankName: a.bankName || '',
                    accountName: a.accountName || '',
                    accountNumber: a.accountNumber || '',
                    ifscCode: a.ifscCode || '',
                    branch: a.branch || '',
                    passbook: a.passbook ? mapFileEntry(a.passbook) : { ...DEFAULT_FILE_ENTRY },
                    checkLeaf: a.checkLeaf ? mapFileEntry(a.checkLeaf) : { ...DEFAULT_FILE_ENTRY },
                    bankStatement: a.bankStatement ? mapFileEntry(a.bankStatement) : { ...DEFAULT_FILE_ENTRY },
                }));

                setBankState((prev) => ({ ...prev, accounts: mappedAccounts }));
            }
        } catch (err) {
            console.error('Failed to populate admin bank details', err);
        }
    }, [bankData, previewMode]);

    const handleFieldChange = useCallback((accountIndex, field, value) => {
        setBankState((prev) => {
            const accounts = [...prev.accounts];
            accounts[accountIndex] = { ...accounts[accountIndex], [field]: value };
            return { ...prev, accounts };
        });
    }, []);

    const handleFileChange = useCallback((accountIndex, fileType, file) => {
        if (!file) {
            setBankState((prev) => {
                const accounts = [...prev.accounts];
                accounts[accountIndex] = {
                    ...accounts[accountIndex],
                    [fileType]: { ...DEFAULT_FILE_ENTRY },
                };
                return { ...prev, accounts };
            });
            return;
        }
        const preview = URL.createObjectURL(file);
        setBankState((prev) => {
            const accounts = [...prev.accounts];
            accounts[accountIndex] = {
                ...accounts[accountIndex],
                [fileType]: {
                    ...accounts[accountIndex][fileType],
                    file,
                    preview,
                    fileName: file.name,
                },
            };
            return { ...prev, accounts };
        });
    }, []);

    const handleRemoveFile = useCallback((accountIndex, fileType) => {
        setBankState((prev) => {
            const accounts = [...prev.accounts];
            accounts[accountIndex] = {
                ...accounts[accountIndex],
                [fileType]: { ...DEFAULT_FILE_ENTRY },
            };
            return { ...prev, accounts };
        });
    }, []);

    const handleAddAccount = useCallback(() => {
        setBankState((prev) => ({
            ...prev,
            accounts: [...prev.accounts, createDefaultAccount(prev.accounts.length)],
        }));
    }, []);

    const handleRemoveAccount = useCallback((accountIndex) => {
        setBankState((prev) => {
            const accounts = prev.accounts.filter((_, i) => i !== accountIndex);
            // Re-index orderIndex
            const reindexed = accounts.map((a, i) => ({ ...a, orderIndex: i }));
            return { ...prev, accounts: reindexed };
        });
    }, []);

    const handleSave = useCallback(async () => {
        setBankState((prev) => ({ ...prev, isSubmitting: true }));
        try {
            const formData = new FormData();

            // Build accounts JSON (text fields only)
            const accountsData = bankState.accounts.map((a) => ({
                orderIndex: a.orderIndex,
                bankName: a.bankName || '',
                accountName: a.accountName || '',
                accountNumber: a.accountNumber || '',
                ifscCode: a.ifscCode || '',
                branch: a.branch || '',
            }));
            formData.append('accounts', JSON.stringify(accountsData));

            // Append files
            bankState.accounts.forEach((a, i) => {
                if (a.passbook?.file) formData.append(`account_${i}_passbook`, a.passbook.file);
                if (a.checkLeaf?.file) formData.append(`account_${i}_check_leaf`, a.checkLeaf.file);
                if (a.bankStatement?.file) formData.append(`account_${i}_bank_statement`, a.bankStatement.file);
            });

            await updateBankAccounts(formData).unwrap();
            return { success: true, message: 'Bank details submitted for approval!' };
        } catch (err) {
            console.error('Failed to save admin bank details', err);
            return { success: false, message: err?.data?.message || err?.message || 'Failed to save bank details' };
        } finally {
            setBankState((prev) => ({ ...prev, isSubmitting: false }));
        }
    }, [bankState, updateBankAccounts]);

    return {
        bankState,
        handleFieldChange,
        handleFileChange,
        handleRemoveFile,
        handleAddAccount,
        handleRemoveAccount,
        handleSave,
    };
};

export default useAdminBankDetails;
