import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    fetchDoctorBankAccounts,
    submitDoctorBankAccounts,
} from '../../redux/doctorSlice';
import {
    setBankField,
    setBankFile,
    removeBankFile,
    addBankAccount,
    removeBankAccount,
    populateBankAccountsFromProfile,
    setBankSubmitting,
} from '../redux/doctorProfileBankDetailsSlice';
import { setSnackbar } from '../redux/doctorProfilePersonalDetailsSlice';
import PREVIEW_SAMPLE_DATA from '../constants/previewSampleData';

const useBankDetails = (previewMode = false) => {
    const dispatch = useDispatch();

    const bankState = useSelector((state) =>
        state.doctorProfileBankDetails || PREVIEW_SAMPLE_DATA.bankDetailsState
    );

    const resolvedBank = previewMode ? PREVIEW_SAMPLE_DATA.bankDetailsState : bankState;

    // Fetch bank accounts on mount
    useEffect(() => {
        if (previewMode) return;
        const load = async () => {
            try {
                const result = await dispatch(fetchDoctorBankAccounts()).unwrap();
                if (result?.accounts) dispatch(populateBankAccountsFromProfile(result.accounts));
            } catch (_) { /* bank accounts may not exist yet */ }
        };
        load();
    }, [dispatch, previewMode]);

    const handleFieldChange = useCallback((accountIndex, field, value) => {
        dispatch(setBankField({ accountIndex, field, value }));
    }, [dispatch]);

    const handleFileChange = useCallback((accountIndex, fileType, file) => {
        if (!file) {
            dispatch(removeBankFile({ accountIndex, fileType }));
            return;
        }
        const preview = URL.createObjectURL(file);
        dispatch(setBankFile({
            accountIndex,
            fileType,
            data: { file, preview, fileName: file.name },
        }));
    }, [dispatch]);

    const handleRemoveFile = useCallback((accountIndex, fileType) => {
        dispatch(removeBankFile({ accountIndex, fileType }));
    }, [dispatch]);

    const handleAddAccount = useCallback(() => {
        dispatch(addBankAccount());
    }, [dispatch]);

    const handleRemoveAccount = useCallback((accountIndex) => {
        dispatch(removeBankAccount({ accountIndex }));
    }, [dispatch]);

    const handleSave = useCallback(async () => {
        dispatch(setBankSubmitting(true));
        try {
            const formData = new FormData();

            // Build accounts JSON (text fields only)
            const accountsData = resolvedBank.accounts.map((a) => ({
                orderIndex: a.orderIndex,
                bankName: a.bankName || '',
                accountName: a.accountName || '',
                accountNumber: a.accountNumber || '',
                ifscCode: a.ifscCode || '',
                branch: a.branch || '',
            }));
            formData.append('accounts', JSON.stringify(accountsData));

            // Append files
            resolvedBank.accounts.forEach((a, i) => {
                if (a.passbook?.file) formData.append(`account_${i}_passbook`, a.passbook.file);
                if (a.checkLeaf?.file) formData.append(`account_${i}_check_leaf`, a.checkLeaf.file);
                if (a.bankStatement?.file) formData.append(`account_${i}_bank_statement`, a.bankStatement.file);
            });

            const result = await dispatch(submitDoctorBankAccounts(formData)).unwrap();
            if (result?.accounts) dispatch(populateBankAccountsFromProfile(result.accounts));
            dispatch(setSnackbar({
                open: true,
                message: 'Bank details saved! Pending admin verification.',
                severity: 'success',
            }));
        } catch (err) {
            dispatch(setSnackbar({
                open: true,
                message: err?.message || err || 'Failed to save bank details',
                severity: 'error',
            }));
        } finally {
            dispatch(setBankSubmitting(false));
        }
    }, [dispatch, resolvedBank]);

    return {
        bankState: resolvedBank,
        handleFieldChange,
        handleFileChange,
        handleRemoveFile,
        handleAddAccount,
        handleRemoveAccount,
        handleSave,
    };
};

export default useBankDetails;
