import React from 'react';
import {
    Box, Grid, TextField, Button, Typography, Paper, IconButton, FormControl, InputLabel, Select, MenuItem, CircularProgress
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import axiosInstance from '../../../../api/axiosConfig';

const FileUploadField = ({ label, fieldName, fileData, onFileChange, onRemoveFile }) => {
    const [previewLoading, setPreviewLoading] = React.useState(false);

    const handlePreview = async () => {
        if (!fileData) return;
        
        // If it's a newly uploaded file (File object), preview instantly
        if (fileData instanceof File) {
            window.open(URL.createObjectURL(fileData), '_blank');
            return;
        }

        // If it's an existing file from backend, fetch presigned URL
        try {
            setPreviewLoading(true);
            const response = await axiosInstance.get(`/api/v1/doctor/profile/documents/presign?field=${fieldName}`);
            if (response.data?.data?.url) {
                window.open(response.data.data.url, '_blank');
            } else if (response.data?.url) { // fallback
                window.open(response.data.url, '_blank');
            }
        } catch (error) {
            console.error('Failed to get presigned URL:', error);
            alert('Failed to load document preview.');
        } finally {
            setPreviewLoading(false);
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>{label}</Typography>
            <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                {fileData instanceof File ? (
                    <Typography variant="caption">{fileData.name}</Typography>
                ) : fileData ? (
                    <Typography variant="caption">Currently Uploaded</Typography>
                ) : (
                    <Typography variant="caption" color="textSecondary">No file uploaded</Typography>
                )}
                
                <Button variant="outlined" component="label" size="small" startIcon={<CloudUploadIcon />}>
                    Upload
                    <input type="file" hidden onChange={(e) => onFileChange(e.target.files[0])} />
                </Button>
                
                {fileData && (
                    <Button 
                        variant="outlined" 
                        color="secondary" 
                        size="small" 
                        startIcon={previewLoading ? <CircularProgress size={16} /> : <VisibilityIcon />}
                        onClick={handlePreview}
                        disabled={previewLoading}
                    >
                        Preview
                    </Button>
                )}

                {fileData && (
                    <IconButton color="error" size="small" onClick={onRemoveFile}>
                        <DeleteIcon />
                    </IconButton>
                )}
            </Box>
        </Paper>
    );
};

const ExtendedProfileFields = ({
    documentData,
    handleDocumentChange,
    handleDocumentFileChange,
    female_data,
    handleFemaleChange,
    communication_data,
    handleCommunicationChange,
    handleCommunicationFileChange,
    permanent_address_data,
    handlePermanentAddressChange,
    handlePermanentAddressFileChange,
    handleCopyCommToPermanent,
    gender
}) => {
    return (
        <Box sx={{ mt: 4 }}>
            {/* ── Document Details ── */}
            <div className="section-title-bar">Identity Documents</div>
            <Grid container spacing={2} sx={{ mb: 4 }}>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Aadhar Number" name="aadhar_number" value={documentData.aadhar_number || ''} onChange={handleDocumentChange} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="PAN Number" name="pan_number" value={documentData.pan_number || ''} onChange={handleDocumentChange} />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <FileUploadField
                        label="Aadhar Proof"
                        fieldName="aadhar_attachment"
                        fileData={documentData.aadhar_attachment}
                        onFileChange={(f) => handleDocumentFileChange('aadhar_attachment', f)}
                        onRemoveFile={() => handleDocumentFileChange('aadhar_attachment', '')}
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <FileUploadField
                        label="PAN Proof"
                        fieldName="pan_attachment"
                        fileData={documentData.pan_attachment}
                        onFileChange={(f) => handleDocumentFileChange('pan_attachment', f)}
                        onRemoveFile={() => handleDocumentFileChange('pan_attachment', '')}
                    />
                </Grid>
            </Grid>

            {/* ── Female Data ── */}
            {gender === 'female' && (
                <>
                    <div className="section-title-bar">Female Specific Medical Data</div>
                    <Grid container spacing={2} sx={{ mb: 4 }}>
                        <Grid item xs={12} sm={6}>
                            <DatePicker
                                label="LMP Date"
                                value={female_data.LMP_calender ? new Date(female_data.LMP_calender) : null}
                                onChange={(date) => handleFemaleChange({ target: { name: 'LMP_calender', value: date ? date.toISOString() : '' } })}
                                renderInput={(params) => <TextField {...params} fullWidth />}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth>
                                <InputLabel>Pregnancy Status</InputLabel>
                                <Select
                                    name="pregnancy_status"
                                    value={female_data.pregnancy_status || ''}
                                    label="Pregnancy Status"
                                    onChange={handleFemaleChange}
                                >
                                    <MenuItem value="Yes">Yes</MenuItem>
                                    <MenuItem value="No">No</MenuItem>
                                    <MenuItem value="Not Sure">Not Sure</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="LMP Remarks" name="LMP_remarks" value={female_data.LMP_remarks || ''} onChange={handleFemaleChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Pregnancy Status Remarks" name="pregnancy_status_remarks" value={female_data.pregnancy_status_remarks || ''} onChange={handleFemaleChange} />
                        </Grid>
                    </Grid>
                </>
            )}

            {/* ── Addresses ── */}
            <div className="section-title-bar">Address Details</div>
            <Grid container spacing={4} sx={{ mb: 4 }}>
                {/* Communication Address */}
                <Grid item xs={12} md={6}>
                    <Typography variant="h6" gutterBottom>Communication Address</Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Door No" name="door_no" value={communication_data.door_no || ''} onChange={handleCommunicationChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Street" name="street" value={communication_data.street || ''} onChange={handleCommunicationChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Landmark" name="landmark" value={communication_data.landmark || ''} onChange={handleCommunicationChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="State" name="state" value={communication_data.state || ''} onChange={handleCommunicationChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="City" name="city" value={communication_data.city || ''} onChange={handleCommunicationChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Pincode" name="pincode" value={communication_data.pincode || ''} onChange={handleCommunicationChange} />
                        </Grid>
                        <Grid item xs={12}>
                            <FileUploadField
                                label="Communication Address Proof"
                                fieldName="comm_address_id_proof_attachment"
                                fileData={communication_data.address_proof}
                                onFileChange={(f) => handleCommunicationFileChange('address_proof', f)}
                                onRemoveFile={() => handleCommunicationFileChange('address_proof', '')}
                            />
                        </Grid>
                    </Grid>
                </Grid>

                {/* Permanent Address */}
                <Grid item xs={12} md={6}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography variant="h6">Permanent Address</Typography>
                        <Button size="small" variant="text" onClick={handleCopyCommToPermanent}>
                            Same as Comm.
                        </Button>
                    </Box>
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Door No" name="door_no" value={permanent_address_data.door_no || ''} onChange={handlePermanentAddressChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Street" name="street" value={permanent_address_data.street || ''} onChange={handlePermanentAddressChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Landmark" name="landmark" value={permanent_address_data.landmark || ''} onChange={handlePermanentAddressChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="State" name="state" value={permanent_address_data.state || ''} onChange={handlePermanentAddressChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="City" name="city" value={permanent_address_data.city || ''} onChange={handlePermanentAddressChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Pincode" name="pincode" value={permanent_address_data.pincode || ''} onChange={handlePermanentAddressChange} />
                        </Grid>
                        <Grid item xs={12}>
                            <FileUploadField
                                label="Permanent Address Proof"
                                fieldName="perm_address_id_proof_attachment"
                                fileData={permanent_address_data.address_proof}
                                onFileChange={(f) => handlePermanentAddressFileChange('address_proof', f)}
                                onRemoveFile={() => handlePermanentAddressFileChange('address_proof', '')}
                            />
                        </Grid>
                    </Grid>
                </Grid>
            </Grid>
        </Box>
    );
};

export default ExtendedProfileFields;
