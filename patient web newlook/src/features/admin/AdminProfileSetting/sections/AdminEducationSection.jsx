import React, { useEffect } from 'react';
import {
    Box, Grid, Paper, Typography, Button, Chip, IconButton,
    FormControl, InputLabel, Select, MenuItem, TextField
} from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import VerifiedIcon from '@mui/icons-material/Verified';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import useAdminEducationDetails from '../hooks/useAdminEducationDetails';
import useAdminProfilePageConfig from '../hooks/useAdminProfilePageConfig';

// Keep a doctor's already-saved value selectable even when the resolved option
// list no longer contains it — admin deactivated / renamed / re-levelled the
// master option, or the options arrive after the saved value hydrates. Without
// this MUI can't match the controlled value and the field renders BLANK, and an
// untouched Save then overwrites the real value with ''. Injecting the saved
// value as the first option keeps it visible and preserved.
const mergeSaved = (list, value) => {
    const arr = Array.isArray(list) ? list : [];
    return value && !arr.includes(value) ? [value, ...arr] : arr;
};


const AdminEducationSection = React.memo(({ previewMode = false, configOverride = null, registerSave }) => {
    const {
        educationState,
        handleEducationFieldChange,
        handleEducationFileChange,
        handleRemoveEducationFile,
        handleSaveEducation,
    } = useAdminEducationDetails(previewMode);

    const cfg = useAdminProfilePageConfig('en', 'admin', configOverride);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSaveEducation, 'Save & Submit Education', educationState?.isSubmitting);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSaveEducation, educationState?.isSubmitting]);

    return (
        <Box>
            <div className="section-title-bar">Education Details</div>
            <Typography variant="body2" color="textSecondary" mb={3}>
                Provide your education details for verification. All fields marked with * are required.
            </Typography>

            {/* -- Graduation Section -- */}
            {cfg.isSectionVisible('education_graduation') && <Paper sx={{ p: 3, mb: 3 }}>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <SchoolIcon color="primary" />
                    <Typography variant="h6" fontWeight="bold">{cfg.getSectionLabel('education_graduation', 'Graduation')}</Typography>
                </Box>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Degree *</InputLabel>
                            <Select
                                value={educationState.graduation.degree}
                                label="Degree *"
                                onChange={(e) => handleEducationFieldChange('graduation', 'degree', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.degrees, educationState.graduation.degree) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.degrees, educationState.graduation.degree).map((d) => (
                                        <MenuItem key={d} value={d}>{d}</MenuItem>
                                    ))
                                    : ['MBBS', 'BDS', 'BAMS', 'BHMS', 'BUMS', 'BPT', 'B.Sc Nursing'].map((d) => (
                                        <MenuItem key={d} value={d}>{d}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>UG Specialization</InputLabel>
                            <Select
                                value={educationState.graduation.specialization}
                                label="UG Specialization"
                                onChange={(e) => handleEducationFieldChange('graduation', 'specialization', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.ugSpecializations, educationState.graduation.specialization) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.ugSpecializations, educationState.graduation.specialization).map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                    : ['General', 'Physician', 'Dental', 'Ayurvedic'].map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>State *</InputLabel>
                            <Select
                                value={educationState.graduation.state}
                                label="State *"
                                onChange={(e) => handleEducationFieldChange('graduation', 'state', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.states, educationState.graduation.state) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.states, educationState.graduation.state).map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                    : ['ANDHRA PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'DELHI', 'GOA', 'GUJARAT', 'HARYANA', 'HIMACHAL PRADESH', 'JAMMU & KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA PRADESH', 'MAHARASHTRA', 'MANIPUR', 'ODISHA', 'PUDUCHERRY', 'PUNJAB', 'RAJASTHAN', 'SIKKIM', 'TAMIL NADU', 'TELANGANA', 'TRIPURA', 'UTTARAKHAND', 'UTTAR PRADESH', 'WEST BENGAL'].map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Graduation University/Bodies *</InputLabel>
                            <Select
                                value={educationState.graduation.university}
                                label="Graduation University/Bodies *"
                                onChange={(e) => handleEducationFieldChange('graduation', 'university', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.universities, educationState.graduation.university) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.universities, educationState.graduation.university).map((u) => (
                                        <MenuItem key={u} value={u}>{u}</MenuItem>
                                    ))
                                    : <MenuItem value="">Loading...</MenuItem>
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Institute/College *</InputLabel>
                            <Select
                                value={educationState.graduation.institute}
                                label="Institute/College *"
                                onChange={(e) => handleEducationFieldChange('graduation', 'institute', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.institutes, educationState.graduation.institute) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.institutes, educationState.graduation.institute).map((i) => (
                                        <MenuItem key={i} value={i}>{i}</MenuItem>
                                    ))
                                    : <MenuItem value="">Loading...</MenuItem>
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Year of Graduation *"
                            type="number"
                            value={educationState.graduation.yearOfGraduation}
                            onChange={(e) => handleEducationFieldChange('graduation', 'yearOfGraduation', e.target.value)}
                            inputProps={{ min: 1950, max: new Date().getFullYear() }}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Evaluation Criteria</InputLabel>
                            <Select
                                value={educationState.graduation.evaluationCriteria}
                                label="Evaluation Criteria"
                                onChange={(e) => handleEducationFieldChange('graduation', 'evaluationCriteria', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.evaluationCriteria, educationState.graduation.evaluationCriteria) || []).map((c) => (
                                    <MenuItem key={c} value={c}>{c}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Obtained Percentage/CGPA/Class"
                            value={educationState.graduation.obtainedScore}
                            onChange={(e) => handleEducationFieldChange('graduation', 'obtainedScore', e.target.value)}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Registration Number"
                            value={educationState.graduation.registrationNumber}
                            onChange={(e) => handleEducationFieldChange('graduation', 'registrationNumber', e.target.value)}
                        />
                    </Grid>
                </Grid>

                {/* Graduation File Uploads */}
                <Grid container spacing={2} sx={{ mt: 2 }}>
                    <Grid item xs={12} sm={6}>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Bachelor's/UG Degree Certificate *</Typography>
                            {(educationState.graduation.certificate.preview || educationState.graduation.certificate.fileUrl) ? (
                                <Box sx={{ mb: 1 }}>
                                    <Typography variant="caption" color="textSecondary">
                                        {educationState.graduation.certificate.fileName || 'Uploaded'}
                                    </Typography>
                                    <Chip
                                        label={educationState.graduation.certificate.verificationStatus}
                                        size="small"
                                        color={educationState.graduation.certificate.verificationStatus === 'verified' ? 'success' : 'warning'}
                                        sx={{ ml: 1 }}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ mb: 1, p: 2, border: '2px dashed #ccc', borderRadius: 2, textAlign: 'center' }}>
                                    <CloudUploadIcon sx={{ fontSize: 32, color: '#ccc' }} />
                                    <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                                </Box>
                            )}
                            <Box display="flex" gap={1}>
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*,.pdf" onChange={(e) => handleEducationFileChange('graduation', 'certificate', e.target.files[0])} />
                                </Button>
                                {(educationState.graduation.certificate.preview || educationState.graduation.certificate.fileUrl) && (
                                    <IconButton color="error" size="small" onClick={() => handleRemoveEducationFile('graduation', 'certificate')}>
                                        <DeleteIcon />
                                    </IconButton>
                                )}
                            </Box>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Bachelor's/UG Mark sheet/s or Transcript *</Typography>
                            {(educationState.graduation.marksheet.preview || educationState.graduation.marksheet.fileUrl) ? (
                                <Box sx={{ mb: 1 }}>
                                    <Typography variant="caption" color="textSecondary">
                                        {educationState.graduation.marksheet.fileName || 'Uploaded'}
                                    </Typography>
                                    <Chip
                                        label={educationState.graduation.marksheet.verificationStatus}
                                        size="small"
                                        color={educationState.graduation.marksheet.verificationStatus === 'verified' ? 'success' : 'warning'}
                                        sx={{ ml: 1 }}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ mb: 1, p: 2, border: '2px dashed #ccc', borderRadius: 2, textAlign: 'center' }}>
                                    <CloudUploadIcon sx={{ fontSize: 32, color: '#ccc' }} />
                                    <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                                </Box>
                            )}
                            <Box display="flex" gap={1}>
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*,.pdf" onChange={(e) => handleEducationFileChange('graduation', 'marksheet', e.target.files[0])} />
                                </Button>
                                {(educationState.graduation.marksheet.preview || educationState.graduation.marksheet.fileUrl) && (
                                    <IconButton color="error" size="small" onClick={() => handleRemoveEducationFile('graduation', 'marksheet')}>
                                        <DeleteIcon />
                                    </IconButton>
                                )}
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            </Paper>}

            {/* -- Post Graduation Section -- */}
            {cfg.isSectionVisible('education_post_graduation') && <Paper sx={{ p: 3, mb: 3 }}>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <SchoolIcon color="secondary" />
                    <Typography variant="h6" fontWeight="bold">{cfg.getSectionLabel('education_post_graduation', 'Post Graduation')}</Typography>
                </Box>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Post Graduation/Diploma Specializations</InputLabel>
                            <Select
                                value={educationState.postGraduation.degree}
                                label="Post Graduation/Diploma Specializations"
                                onChange={(e) => handleEducationFieldChange('postGraduation', 'degree', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.pgDegrees, educationState.postGraduation.degree) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.pgDegrees, educationState.postGraduation.degree).map((d) => (
                                        <MenuItem key={d} value={d}>{d}</MenuItem>
                                    ))
                                    : ['MD', 'MS', 'MDS', 'DNB', 'Diploma'].map((d) => (
                                        <MenuItem key={d} value={d}>{d}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>PG/Diploma Specialization</InputLabel>
                            <Select
                                value={educationState.postGraduation.specialization}
                                label="PG/Diploma Specialization"
                                onChange={(e) => handleEducationFieldChange('postGraduation', 'specialization', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.pgSpecializations, educationState.postGraduation.specialization) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.pgSpecializations, educationState.postGraduation.specialization).map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                    : ['General Medicine', 'General Surgery', 'Orthopaedics', 'Paediatrics', 'Dermatology', 'Ophthalmology', 'ENT', 'Radiology', 'Anaesthesia', 'Psychiatry', 'Obstetrics & Gynaecology', 'Pathology', 'Microbiology', 'Pharmacology', 'Forensic Medicine', 'Community Medicine'].map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>State</InputLabel>
                            <Select
                                value={educationState.postGraduation.state}
                                label="State"
                                onChange={(e) => handleEducationFieldChange('postGraduation', 'state', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.states, educationState.postGraduation.state) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.states, educationState.postGraduation.state).map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                    : ['ANDHRA PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'DELHI', 'GOA', 'GUJARAT', 'HARYANA', 'HIMACHAL PRADESH', 'JAMMU & KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA PRADESH', 'MAHARASHTRA', 'MANIPUR', 'ODISHA', 'PUDUCHERRY', 'PUNJAB', 'RAJASTHAN', 'SIKKIM', 'TAMIL NADU', 'TELANGANA', 'TRIPURA', 'UTTARAKHAND', 'UTTAR PRADESH', 'WEST BENGAL'].map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>PG/Diploma University/Bodies</InputLabel>
                            <Select
                                value={educationState.postGraduation.university}
                                label="PG/Diploma University/Bodies"
                                onChange={(e) => handleEducationFieldChange('postGraduation', 'university', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.pgUniversities, educationState.postGraduation.university) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.pgUniversities, educationState.postGraduation.university).map((u) => (
                                        <MenuItem key={u} value={u}>{u}</MenuItem>
                                    ))
                                    : <MenuItem value="">Loading...</MenuItem>
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Institute/College</InputLabel>
                            <Select
                                value={educationState.postGraduation.institute}
                                label="Institute/College"
                                onChange={(e) => handleEducationFieldChange('postGraduation', 'institute', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.pgInstitutes, educationState.postGraduation.institute) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.pgInstitutes, educationState.postGraduation.institute).map((i) => (
                                        <MenuItem key={i} value={i}>{i}</MenuItem>
                                    ))
                                    : <MenuItem value="">Loading...</MenuItem>
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Year of Graduation"
                            type="number"
                            value={educationState.postGraduation.yearOfGraduation}
                            onChange={(e) => handleEducationFieldChange('postGraduation', 'yearOfGraduation', e.target.value)}
                            inputProps={{ min: 1950, max: new Date().getFullYear() }}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Evaluation Criteria</InputLabel>
                            <Select
                                value={educationState.postGraduation.evaluationCriteria}
                                label="Evaluation Criteria"
                                onChange={(e) => handleEducationFieldChange('postGraduation', 'evaluationCriteria', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.evaluationCriteria, educationState.postGraduation.evaluationCriteria) || []).map((c) => (
                                    <MenuItem key={c} value={c}>{c}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Obtained Percentage/CGPA/Class"
                            value={educationState.postGraduation.obtainedScore}
                            onChange={(e) => handleEducationFieldChange('postGraduation', 'obtainedScore', e.target.value)}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Registration Number"
                            value={educationState.postGraduation.registrationNumber}
                            onChange={(e) => handleEducationFieldChange('postGraduation', 'registrationNumber', e.target.value)}
                        />
                    </Grid>
                </Grid>

                {/* Post Graduation File Uploads */}
                <Grid container spacing={2} sx={{ mt: 2 }}>
                    <Grid item xs={12} sm={6}>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Diploma/PG Certificate *</Typography>
                            {(educationState.postGraduation.certificate.preview || educationState.postGraduation.certificate.fileUrl) ? (
                                <Box sx={{ mb: 1 }}>
                                    <Typography variant="caption" color="textSecondary">
                                        {educationState.postGraduation.certificate.fileName || 'Uploaded'}
                                    </Typography>
                                    <Chip
                                        label={educationState.postGraduation.certificate.verificationStatus}
                                        size="small"
                                        color={educationState.postGraduation.certificate.verificationStatus === 'verified' ? 'success' : 'warning'}
                                        sx={{ ml: 1 }}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ mb: 1, p: 2, border: '2px dashed #ccc', borderRadius: 2, textAlign: 'center' }}>
                                    <CloudUploadIcon sx={{ fontSize: 32, color: '#ccc' }} />
                                    <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                                </Box>
                            )}
                            <Box display="flex" gap={1}>
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*,.pdf" onChange={(e) => handleEducationFileChange('postGraduation', 'certificate', e.target.files[0])} />
                                </Button>
                                {(educationState.postGraduation.certificate.preview || educationState.postGraduation.certificate.fileUrl) && (
                                    <IconButton color="error" size="small" onClick={() => handleRemoveEducationFile('postGraduation', 'certificate')}>
                                        <DeleteIcon />
                                    </IconButton>
                                )}
                            </Box>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Diploma/PG Mark sheet/s or Transcript *</Typography>
                            {(educationState.postGraduation.marksheet.preview || educationState.postGraduation.marksheet.fileUrl) ? (
                                <Box sx={{ mb: 1 }}>
                                    <Typography variant="caption" color="textSecondary">
                                        {educationState.postGraduation.marksheet.fileName || 'Uploaded'}
                                    </Typography>
                                    <Chip
                                        label={educationState.postGraduation.marksheet.verificationStatus}
                                        size="small"
                                        color={educationState.postGraduation.marksheet.verificationStatus === 'verified' ? 'success' : 'warning'}
                                        sx={{ ml: 1 }}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ mb: 1, p: 2, border: '2px dashed #ccc', borderRadius: 2, textAlign: 'center' }}>
                                    <CloudUploadIcon sx={{ fontSize: 32, color: '#ccc' }} />
                                    <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                                </Box>
                            )}
                            <Box display="flex" gap={1}>
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*,.pdf" onChange={(e) => handleEducationFileChange('postGraduation', 'marksheet', e.target.files[0])} />
                                </Button>
                                {(educationState.postGraduation.marksheet.preview || educationState.postGraduation.marksheet.fileUrl) && (
                                    <IconButton color="error" size="small" onClick={() => handleRemoveEducationFile('postGraduation', 'marksheet')}>
                                        <DeleteIcon />
                                    </IconButton>
                                )}
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            </Paper>}

            {/* -- Super Speciality Section -- */}
            {cfg.isSectionVisible('education_super_speciality') && <Paper sx={{ p: 3, mb: 3 }}>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <VerifiedIcon color="success" />
                    <Typography variant="h6" fontWeight="bold">{cfg.getSectionLabel('education_super_speciality', 'Super Speciality')}</Typography>
                </Box>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Post Graduation/Diploma</InputLabel>
                            <Select
                                value={educationState.superSpeciality.degree}
                                label="Post Graduation/Diploma"
                                onChange={(e) => handleEducationFieldChange('superSpeciality', 'degree', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.superSpecialityDegrees, educationState.superSpeciality.degree) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.superSpecialityDegrees, educationState.superSpeciality.degree).map((d) => (
                                        <MenuItem key={d} value={d}>{d}</MenuItem>
                                    ))
                                    : ['DM', 'MCh', 'DNB Super Speciality'].map((d) => (
                                        <MenuItem key={d} value={d}>{d}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Super Speciality Specialization</InputLabel>
                            <Select
                                value={educationState.superSpeciality.specialization}
                                label="Super Speciality Specialization"
                                onChange={(e) => handleEducationFieldChange('superSpeciality', 'specialization', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.superSpecialitySpecializations, educationState.superSpeciality.specialization) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.superSpecialitySpecializations, educationState.superSpeciality.specialization).map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                    : ['Cardiology', 'Neurology', 'Nephrology', 'Gastroenterology', 'Pulmonology', 'Endocrinology', 'Oncology', 'Cardiothoracic Surgery', 'Neurosurgery', 'Urology', 'Plastic Surgery', 'Pediatric Surgery', 'Surgical Gastroenterology', 'Neonatology', 'Hematology'].map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>State</InputLabel>
                            <Select
                                value={educationState.superSpeciality.state}
                                label="State"
                                onChange={(e) => handleEducationFieldChange('superSpeciality', 'state', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.states, educationState.superSpeciality.state) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.states, educationState.superSpeciality.state).map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                    : ['ANDHRA PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'DELHI', 'GOA', 'GUJARAT', 'HARYANA', 'HIMACHAL PRADESH', 'JAMMU & KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA PRADESH', 'MAHARASHTRA', 'MANIPUR', 'ODISHA', 'PUDUCHERRY', 'PUNJAB', 'RAJASTHAN', 'SIKKIM', 'TAMIL NADU', 'TELANGANA', 'TRIPURA', 'UTTARAKHAND', 'UTTAR PRADESH', 'WEST BENGAL'].map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>University/Bodies</InputLabel>
                            <Select
                                value={educationState.superSpeciality.university}
                                label="University/Bodies"
                                onChange={(e) => handleEducationFieldChange('superSpeciality', 'university', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.superSpecialityUniversities, educationState.superSpeciality.university) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.superSpecialityUniversities, educationState.superSpeciality.university).map((u) => (
                                        <MenuItem key={u} value={u}>{u}</MenuItem>
                                    ))
                                    : <MenuItem value="">Loading...</MenuItem>
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Institute/College</InputLabel>
                            <Select
                                value={educationState.superSpeciality.institute}
                                label="Institute/College"
                                onChange={(e) => handleEducationFieldChange('superSpeciality', 'institute', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.superSpecialityInstitutes, educationState.superSpeciality.institute) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.superSpecialityInstitutes, educationState.superSpeciality.institute).map((i) => (
                                        <MenuItem key={i} value={i}>{i}</MenuItem>
                                    ))
                                    : <MenuItem value="">Loading...</MenuItem>
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Year of Graduation"
                            type="number"
                            value={educationState.superSpeciality.yearOfGraduation}
                            onChange={(e) => handleEducationFieldChange('superSpeciality', 'yearOfGraduation', e.target.value)}
                            inputProps={{ min: 1950, max: new Date().getFullYear() }}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Evaluation Criteria</InputLabel>
                            <Select
                                value={educationState.superSpeciality.evaluationCriteria}
                                label="Evaluation Criteria"
                                onChange={(e) => handleEducationFieldChange('superSpeciality', 'evaluationCriteria', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.evaluationCriteria, educationState.superSpeciality.evaluationCriteria) || []).map((c) => (
                                    <MenuItem key={c} value={c}>{c}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Obtained Percentage/CGPA/Class"
                            value={educationState.superSpeciality.obtainedScore}
                            onChange={(e) => handleEducationFieldChange('superSpeciality', 'obtainedScore', e.target.value)}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Registration Number"
                            value={educationState.superSpeciality.registrationNumber}
                            onChange={(e) => handleEducationFieldChange('superSpeciality', 'registrationNumber', e.target.value)}
                        />
                    </Grid>
                </Grid>

                {/* Super Speciality File Uploads */}
                <Grid container spacing={2} sx={{ mt: 2 }}>
                    <Grid item xs={12} sm={6}>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Super Speciality Certificate *</Typography>
                            {(educationState.superSpeciality.certificate.preview || educationState.superSpeciality.certificate.fileUrl) ? (
                                <Box sx={{ mb: 1 }}>
                                    <Typography variant="caption" color="textSecondary">
                                        {educationState.superSpeciality.certificate.fileName || 'Uploaded'}
                                    </Typography>
                                    <Chip
                                        label={educationState.superSpeciality.certificate.verificationStatus}
                                        size="small"
                                        color={educationState.superSpeciality.certificate.verificationStatus === 'verified' ? 'success' : 'warning'}
                                        sx={{ ml: 1 }}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ mb: 1, p: 2, border: '2px dashed #ccc', borderRadius: 2, textAlign: 'center' }}>
                                    <CloudUploadIcon sx={{ fontSize: 32, color: '#ccc' }} />
                                    <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                                </Box>
                            )}
                            <Box display="flex" gap={1}>
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*,.pdf" onChange={(e) => handleEducationFileChange('superSpeciality', 'certificate', e.target.files[0])} />
                                </Button>
                                {(educationState.superSpeciality.certificate.preview || educationState.superSpeciality.certificate.fileUrl) && (
                                    <IconButton color="error" size="small" onClick={() => handleRemoveEducationFile('superSpeciality', 'certificate')}>
                                        <DeleteIcon />
                                    </IconButton>
                                )}
                            </Box>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Super Speciality Mark sheet/s or Transcript *</Typography>
                            {(educationState.superSpeciality.marksheet.preview || educationState.superSpeciality.marksheet.fileUrl) ? (
                                <Box sx={{ mb: 1 }}>
                                    <Typography variant="caption" color="textSecondary">
                                        {educationState.superSpeciality.marksheet.fileName || 'Uploaded'}
                                    </Typography>
                                    <Chip
                                        label={educationState.superSpeciality.marksheet.verificationStatus}
                                        size="small"
                                        color={educationState.superSpeciality.marksheet.verificationStatus === 'verified' ? 'success' : 'warning'}
                                        sx={{ ml: 1 }}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ mb: 1, p: 2, border: '2px dashed #ccc', borderRadius: 2, textAlign: 'center' }}>
                                    <CloudUploadIcon sx={{ fontSize: 32, color: '#ccc' }} />
                                    <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                                </Box>
                            )}
                            <Box display="flex" gap={1}>
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*,.pdf" onChange={(e) => handleEducationFileChange('superSpeciality', 'marksheet', e.target.files[0])} />
                                </Button>
                                {(educationState.superSpeciality.marksheet.preview || educationState.superSpeciality.marksheet.fileUrl) && (
                                    <IconButton color="error" size="small" onClick={() => handleRemoveEducationFile('superSpeciality', 'marksheet')}>
                                        <DeleteIcon />
                                    </IconButton>
                                )}
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            </Paper>}

            {/* -- Any Other Certification/Course Section -- */}
            {cfg.isSectionVisible('education_other_certification') && <Paper sx={{ p: 3, mb: 3 }}>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <SchoolIcon sx={{ color: '#ff9800' }} />
                    <Typography variant="h6" fontWeight="bold">{cfg.getSectionLabel('education_other_certification', 'Any Other Certification/Course')}</Typography>
                </Box>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Course Name"
                            value={educationState.otherCertification.courseName}
                            onChange={(e) => handleEducationFieldChange('otherCertification', 'courseName', e.target.value)}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Specialization</InputLabel>
                            <Select
                                value={educationState.otherCertification.specialization}
                                label="Specialization"
                                onChange={(e) => handleEducationFieldChange('otherCertification', 'specialization', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.pgSpecializations, educationState.otherCertification.specialization) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.pgSpecializations, educationState.otherCertification.specialization).map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                    : <MenuItem value="">Loading...</MenuItem>
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>State</InputLabel>
                            <Select
                                value={educationState.otherCertification.state}
                                label="State"
                                onChange={(e) => handleEducationFieldChange('otherCertification', 'state', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.states, educationState.otherCertification.state) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.states, educationState.otherCertification.state).map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                    : ['ANDHRA PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'DELHI', 'GOA', 'GUJARAT', 'HARYANA', 'HIMACHAL PRADESH', 'JAMMU & KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA PRADESH', 'MAHARASHTRA', 'MANIPUR', 'ODISHA', 'PUDUCHERRY', 'PUNJAB', 'RAJASTHAN', 'SIKKIM', 'TAMIL NADU', 'TELANGANA', 'TRIPURA', 'UTTARAKHAND', 'UTTAR PRADESH', 'WEST BENGAL'].map((s) => (
                                        <MenuItem key={s} value={s}>{s}</MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>University/Bodies</InputLabel>
                            <Select
                                value={educationState.otherCertification.university}
                                label="University/Bodies"
                                onChange={(e) => handleEducationFieldChange('otherCertification', 'university', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.universities, educationState.otherCertification.university) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.universities, educationState.otherCertification.university).map((u) => (
                                        <MenuItem key={u} value={u}>{u}</MenuItem>
                                    ))
                                    : <MenuItem value="">Loading...</MenuItem>
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Institute/College</InputLabel>
                            <Select
                                value={educationState.otherCertification.institute}
                                label="Institute/College"
                                onChange={(e) => handleEducationFieldChange('otherCertification', 'institute', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.institutes, educationState.otherCertification.institute) || []).length > 0
                                    ? mergeSaved(educationState.dropdownOptions?.institutes, educationState.otherCertification.institute).map((i) => (
                                        <MenuItem key={i} value={i}>{i}</MenuItem>
                                    ))
                                    : <MenuItem value="">Loading...</MenuItem>
                                }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Year of Course"
                            type="number"
                            value={educationState.otherCertification.yearOfCourse}
                            onChange={(e) => handleEducationFieldChange('otherCertification', 'yearOfCourse', e.target.value)}
                            inputProps={{ min: 1950, max: new Date().getFullYear() }}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth>
                            <InputLabel>Evaluation Criteria</InputLabel>
                            <Select
                                value={educationState.otherCertification.evaluationCriteria}
                                label="Evaluation Criteria"
                                onChange={(e) => handleEducationFieldChange('otherCertification', 'evaluationCriteria', e.target.value)}
                            >
                                {(mergeSaved(educationState.dropdownOptions?.evaluationCriteria, educationState.otherCertification.evaluationCriteria) || []).map((c) => (
                                    <MenuItem key={c} value={c}>{c}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Obtained Percentage/CGPA/Class"
                            value={educationState.otherCertification.obtainedScore}
                            onChange={(e) => handleEducationFieldChange('otherCertification', 'obtainedScore', e.target.value)}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Registration Number"
                            value={educationState.otherCertification.registrationNumber}
                            onChange={(e) => handleEducationFieldChange('otherCertification', 'registrationNumber', e.target.value)}
                        />
                    </Grid>
                </Grid>

                {/* Other Certification File Uploads */}
                <Grid container spacing={2} sx={{ mt: 2 }}>
                    <Grid item xs={12} sm={6}>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Upload Your Certificate *</Typography>
                            {(educationState.otherCertification.certificate.preview || educationState.otherCertification.certificate.fileUrl) ? (
                                <Box sx={{ mb: 1 }}>
                                    <Typography variant="caption" color="textSecondary">
                                        {educationState.otherCertification.certificate.fileName || 'Uploaded'}
                                    </Typography>
                                    <Chip
                                        label={educationState.otherCertification.certificate.verificationStatus}
                                        size="small"
                                        color={educationState.otherCertification.certificate.verificationStatus === 'verified' ? 'success' : 'warning'}
                                        sx={{ ml: 1 }}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ mb: 1, p: 2, border: '2px dashed #ccc', borderRadius: 2, textAlign: 'center' }}>
                                    <CloudUploadIcon sx={{ fontSize: 32, color: '#ccc' }} />
                                    <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                                </Box>
                            )}
                            <Box display="flex" gap={1}>
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*,.pdf" onChange={(e) => handleEducationFileChange('otherCertification', 'certificate', e.target.files[0])} />
                                </Button>
                                {(educationState.otherCertification.certificate.preview || educationState.otherCertification.certificate.fileUrl) && (
                                    <IconButton color="error" size="small" onClick={() => handleRemoveEducationFile('otherCertification', 'certificate')}>
                                        <DeleteIcon />
                                    </IconButton>
                                )}
                            </Box>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Upload Your Mark sheet/s or Transcript *</Typography>
                            {(educationState.otherCertification.marksheet.preview || educationState.otherCertification.marksheet.fileUrl) ? (
                                <Box sx={{ mb: 1 }}>
                                    <Typography variant="caption" color="textSecondary">
                                        {educationState.otherCertification.marksheet.fileName || 'Uploaded'}
                                    </Typography>
                                    <Chip
                                        label={educationState.otherCertification.marksheet.verificationStatus}
                                        size="small"
                                        color={educationState.otherCertification.marksheet.verificationStatus === 'verified' ? 'success' : 'warning'}
                                        sx={{ ml: 1 }}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ mb: 1, p: 2, border: '2px dashed #ccc', borderRadius: 2, textAlign: 'center' }}>
                                    <CloudUploadIcon sx={{ fontSize: 32, color: '#ccc' }} />
                                    <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                                </Box>
                            )}
                            <Box display="flex" gap={1}>
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*,.pdf" onChange={(e) => handleEducationFileChange('otherCertification', 'marksheet', e.target.files[0])} />
                                </Button>
                                {(educationState.otherCertification.marksheet.preview || educationState.otherCertification.marksheet.fileUrl) && (
                                    <IconButton color="error" size="small" onClick={() => handleRemoveEducationFile('otherCertification', 'marksheet')}>
                                        <DeleteIcon />
                                    </IconButton>
                                )}
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            </Paper>}

            {/* Save Button */}
            <Box display="flex" justifyContent="flex-end" mt={3} gap={2}>
                <Button variant="contained" onClick={handleSaveEducation} disabled={educationState?.isSubmitting} startIcon={<SaveIcon />}>
                    {educationState?.isSubmitting ? 'Saving...' : 'Save & Submit Education'}
                </Button>
            </Box>
        </Box>
    );
});

AdminEducationSection.displayName = 'AdminEducationSection';
export default AdminEducationSection;
