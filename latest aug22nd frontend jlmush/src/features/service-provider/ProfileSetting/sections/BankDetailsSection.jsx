import React, { useEffect } from 'react';
import {
    Box, Grid, Paper, Typography, Button, Chip, TextField, IconButton, Alert,
} from '@mui/material';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import VerifiedIcon from '@mui/icons-material/Verified';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useDispatch } from 'react-redux';
import useBankDetails from '../hooks/useBankDetails';
import useDoctorProfilePageConfig from '../hooks/useDoctorProfilePageConfig';
import DocUploadField from '../components/DocUploadField';
import ApprovalChip from '../../../../common/components/ApprovalChip/ApprovalChip';
import { useGetFieldStatusesQuery } from '../../../admin/api/fieldApprovalEndpoints';
import { useGetMyDoctorIdQuery } from '../../api/scopedDoctorApi';
import {
    confirmDoctorPennyDrop,
    fetchDoctorBankAccounts,
    suspendDoctorBankAccount,
    removeDoctorBankAccount,
} from '../../redux/doctorSlice';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import { populateBankAccountsFromProfile } from '../redux/doctorProfileBankDetailsSlice';

const ACCOUNT_LABELS = ['Primary Account *', 'Secondary Account'];

const getAccountLabel = (index) => {
    if (index < ACCOUNT_LABELS.length) return ACCOUNT_LABELS[index];
    return `Additional Account ${index - 1}`;
};

const getVerificationChip = (status) => {
    if (status === 'verified') {
        return <Chip icon={<VerifiedIcon />} label="Verified" color="success" size="small" />;
    }
    if (status === 'rejected') {
        return <Chip label="Rejected" color="error" size="small" />;
    }
    return <Chip label="Pending" color="warning" size="small" variant="outlined" />;
};

const BankDetailsSection = React.memo(({ previewMode = false, configOverride = null, registerSave }) => {
    const {
        bankState,
        handleFieldChange,
        handleFileChange,
        handleRemoveFile,
        handleAddAccount,
        handleRemoveAccount,
        handleSave,
    } = useBankDetails(previewMode);

    const cfg = useDoctorProfilePageConfig('en', 'doctor', configOverride);
    const dispatch = useDispatch();
    const [pennyBusy, setPennyBusy] = React.useState(null);
    // Account awaiting the "this will hold your payouts" confirmation.
    const [removeTarget, setRemoveTarget] = React.useState(null);

    // Re-read the accounts from the server AND map them back into the form
    // slice. fetchDoctorBankAccounts alone is not enough: the bank form slice
    // is only ever filled by populateBankAccountsFromProfile (it has no
    // extraReducer for the fetch), so without this the row keeps rendering the
    // stale pre-action state — the confirm button would stay visible and the
    // chip stuck on "Pending" even though the backend already verified it.
    const refreshAccounts = async () => {
        const result = await dispatch(fetchDoctorBankAccounts()).unwrap();
        if (result?.accounts) dispatch(populateBankAccountsFromProfile(result.accounts));
    };

    const handleConfirmPennyDrop = async (accountId) => {
        setPennyBusy(accountId);
        try {
            await dispatch(confirmDoctorPennyDrop(accountId)).unwrap();
            await refreshAccounts();
        } catch (e) {
            // eslint-disable-next-line no-alert
            alert(e?.message || e?.error || 'Could not confirm the penny drop.');
        } finally {
            setPennyBusy(null);
        }
    };

    // Suspend / Remove act on the SERVER copy of the account (Cashfree
    // beneficiary + row), unlike the form-level "+ Add / delete row" controls.
    const handleSuspend = async (accountId) => {
        setPennyBusy(accountId);
        try {
            const res = await dispatch(suspendDoctorBankAccount(accountId)).unwrap();
            await refreshAccounts();
            // eslint-disable-next-line no-alert
            alert(res?.message || 'Payouts to this account are suspended.');
        } catch (e) {
            // eslint-disable-next-line no-alert
            alert(e?.message || e?.error || 'Could not suspend this account.');
        } finally {
            setPennyBusy(null);
        }
    };

    const handleServerRemove = async (accountId) => {
        setPennyBusy(accountId);
        try {
            const res = await dispatch(removeDoctorBankAccount(accountId)).unwrap();
            await refreshAccounts();
            // eslint-disable-next-line no-alert
            alert(res?.message || 'Bank account removed.');
        } catch (e) {
            // eslint-disable-next-line no-alert
            alert(e?.message || e?.error || 'Could not remove this account.');
        } finally {
            setPennyBusy(null);
            setRemoveTarget(null);
        }
    };

    // Fetch field approval statuses
    const { data: myDoctorId } = useGetMyDoctorIdQuery(undefined, { skip: previewMode });
    const { data: fieldStatusData } = useGetFieldStatusesQuery(
        { entityType: 'doctor', entityId: myDoctorId },
        { skip: previewMode || !myDoctorId }
    );
    const fieldStatuses = fieldStatusData?.field_statuses || {};

    const getFieldApprovalStatus = (fieldName) => {
        const key = `bank_details.${fieldName}`;
        return fieldStatuses[key]?.status || null;
    };

    const pendingFields = Object.entries(fieldStatuses)
        .filter(([key, info]) => key.startsWith('bank_details.') && (info.status === 'pending' || info.status === 'query'))
        .map(([key, info]) => ({ key, ...info }));

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, 'Save & Submit Bank Details', bankState?.isSubmitting);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSave, bankState?.isSubmitting]);

    return (
        <Box>
            {pendingFields.length > 0 && !previewMode && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <Typography variant="body2" fontWeight="bold">
                        {pendingFields.length} bank detail field(s) waiting for approval
                    </Typography>
                </Alert>
            )}
            {/* Section Header */}
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <AccountBalanceIcon color="primary" />
                <Typography variant="h6" fontWeight="bold">
                    {cfg.getFieldLabel?.('bank_name') ? 'Bank Details' : 'My Bank Details'}
                </Typography>
            </Box>

            {/* Bank Account Cards */}
            {bankState.accounts.map((account, index) => (
                <Paper key={index} elevation={1} sx={{ p: 3, mb: 3, borderRadius: 2 }}>
                    {/* Account Header */}
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Box display="flex" alignItems="center" gap={1.5}>
                            <Typography variant="subtitle1" fontWeight="bold">
                                {getAccountLabel(index)}
                            </Typography>
                            {getVerificationChip(account.verificationStatus)}
                            <ApprovalChip status={getFieldApprovalStatus(`account_${index}_bank_name`)} />
                            {account.beneficiaryStatus === 'penny_sent' && !previewMode && (
                                <Button
                                    size="small"
                                    variant="contained"
                                    color="success"
                                    disabled={pennyBusy === account.id}
                                    onClick={() => handleConfirmPennyDrop(account.id)}
                                >
                                    {pennyBusy === account.id ? 'Confirming…' : "I received ₹1 — Verify account"}
                                </Button>
                            )}
                            {/* Suspend — pause payouts to this account, keep it (re-verifiable). */}
                            {account.id && !previewMode
                              && account.beneficiaryStatus
                              && !['none', 'removed'].includes(account.beneficiaryStatus) && (
                                <Button
                                    size="small" variant="outlined" color="warning"
                                    startIcon={<BlockIcon />}
                                    disabled={pennyBusy === account.id}
                                    onClick={() => handleSuspend(account.id)}
                                >
                                    Suspend
                                </Button>
                            )}
                            {/* Remove — delete the beneficiary + this account entirely. */}
                            {account.id && !previewMode && (
                                <Button
                                    size="small" variant="outlined" color="error"
                                    startIcon={<DeleteIcon />}
                                    disabled={pennyBusy === account.id}
                                    onClick={() => setRemoveTarget(account)}
                                >
                                    Remove
                                </Button>
                            )}
                        </Box>
                        {index > 1 && !previewMode && (
                            <IconButton
                                color="error"
                                size="small"
                                onClick={() => handleRemoveAccount(index)}
                            >
                                <DeleteIcon />
                            </IconButton>
                        )}
                    </Box>

                    {/* Account Fields */}
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        <Grid item xs={12} sm={6} md={4}>
                            <TextField
                                fullWidth
                                size="small"
                                label="Bank Name"
                                value={account.bankName}
                                onChange={(e) => handleFieldChange(index, 'bankName', e.target.value)}
                                disabled={previewMode}
                                required={index === 0}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={4}>
                            <TextField
                                fullWidth
                                size="small"
                                label="Account Holder Name"
                                value={account.accountName}
                                onChange={(e) => handleFieldChange(index, 'accountName', e.target.value)}
                                disabled={previewMode}
                                required={index === 0}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={4}>
                            <TextField
                                fullWidth
                                size="small"
                                label="Account Number"
                                value={account.accountNumber}
                                onChange={(e) => handleFieldChange(index, 'accountNumber', e.target.value)}
                                disabled={previewMode}
                                required={index === 0}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={4}>
                            <TextField
                                fullWidth
                                size="small"
                                label="IFSC Code"
                                value={account.ifscCode}
                                onChange={(e) => handleFieldChange(index, 'ifscCode', e.target.value.toUpperCase())}
                                disabled={previewMode}
                                required={index === 0}
                                inputProps={{ style: { textTransform: 'uppercase' } }}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={4}>
                            <TextField
                                fullWidth
                                size="small"
                                label="Branch"
                                value={account.branch}
                                onChange={(e) => handleFieldChange(index, 'branch', e.target.value)}
                                disabled={previewMode}
                            />
                        </Grid>
                    </Grid>

                    {/* Document Uploads */}
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5, color: 'text.secondary' }}>
                        Attachments (Bank Passbook / Check Leaf / Bank Statement)
                    </Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={4}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Bank Passbook
                            </Typography>
                            {getVerificationChip(account.passbook?.verificationStatus)}
                            <Box sx={{ mt: 1 }}>
                                <DocUploadField
                                    fieldName={`account_${index}_passbook`}
                                    label="Upload Passbook"
                                    accept="image/*,.pdf"
                                    value={account.passbook?.file || account.passbook?.fileUrl || ''}
                                    onChange={(file) => handleFileChange(index, 'passbook', file)}
                                    onClear={() => handleRemoveFile(index, 'passbook')}
                                />
                            </Box>
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Check Leaf
                            </Typography>
                            {getVerificationChip(account.checkLeaf?.verificationStatus)}
                            <Box sx={{ mt: 1 }}>
                                <DocUploadField
                                    fieldName={`account_${index}_check_leaf`}
                                    label="Upload Check Leaf"
                                    accept="image/*,.pdf"
                                    value={account.checkLeaf?.file || account.checkLeaf?.fileUrl || ''}
                                    onChange={(file) => handleFileChange(index, 'checkLeaf', file)}
                                    onClear={() => handleRemoveFile(index, 'checkLeaf')}
                                />
                            </Box>
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Bank Statement
                            </Typography>
                            {getVerificationChip(account.bankStatement?.verificationStatus)}
                            <Box sx={{ mt: 1 }}>
                                <DocUploadField
                                    fieldName={`account_${index}_bank_statement`}
                                    label="Upload Statement"
                                    accept="image/*,.pdf"
                                    value={account.bankStatement?.file || account.bankStatement?.fileUrl || ''}
                                    onChange={(file) => handleFileChange(index, 'bankStatement', file)}
                                    onClear={() => handleRemoveFile(index, 'bankStatement')}
                                />
                            </Box>
                        </Grid>
                    </Grid>
                </Paper>
            ))}

            {/* Add More Button */}
            {!previewMode && (
                <Box display="flex" justifyContent="center" mt={2}>
                    <Button
                        variant="outlined"
                        startIcon={<AddIcon />}
                        onClick={handleAddAccount}
                        sx={{ textTransform: 'none' }}
                    >
                        + Add More Account
                    </Button>
                </Box>
            )}

            {/* Confirm removing a bank account from Cashfree + the profile */}
            <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Remove this bank account?</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Your payouts will be held. Until you add a new account and verify
                        it with a ₹1 penny drop, no payout can be sent to you.
                    </Alert>
                    <Typography variant="body2" color="text.secondary">
                        This removes <strong>{removeTarget?.bankName || 'this account'}</strong>
                        {removeTarget?.accountNumber ? ` (…${String(removeTarget.accountNumber).slice(-4)})` : ''}
                        {' '}from payouts and deletes it from your profile. Your past payout
                        records are kept. To pause payouts without deleting, use{' '}
                        <strong>Suspend</strong> instead.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRemoveTarget(null)}>Cancel</Button>
                    <Button
                        variant="contained" color="error"
                        disabled={pennyBusy === removeTarget?.id}
                        onClick={() => handleServerRemove(removeTarget?.id)}
                    >
                        Remove account
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
});

BankDetailsSection.displayName = 'BankDetailsSection';
export default BankDetailsSection;
