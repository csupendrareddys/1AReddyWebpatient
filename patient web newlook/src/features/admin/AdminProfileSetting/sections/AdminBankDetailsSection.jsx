import React, { useEffect } from 'react';
import {
    Box, Grid, Paper, Typography, Button, Chip, TextField, IconButton,
} from '@mui/material';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import VerifiedIcon from '@mui/icons-material/Verified';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import useAdminBankDetails from '../hooks/useAdminBankDetails';
import useAdminProfilePageConfig from '../hooks/useAdminProfilePageConfig';
import DocUploadField from '../../../service-provider/ProfileSetting/components/DocUploadField';

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

const AdminBankDetailsSection = React.memo(({ previewMode = false, configOverride = null, registerSave }) => {
    const {
        bankState,
        handleFieldChange,
        handleFileChange,
        handleRemoveFile,
        handleAddAccount,
        handleRemoveAccount,
        handleSave,
    } = useAdminBankDetails(previewMode);

    const cfg = useAdminProfilePageConfig('en', 'admin', configOverride);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, 'Save & Submit Bank Details', bankState?.isSubmitting);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSave, bankState?.isSubmitting]);

    return (
        <Box>
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
        </Box>
    );
});

AdminBankDetailsSection.displayName = 'AdminBankDetailsSection';
export default AdminBankDetailsSection;
