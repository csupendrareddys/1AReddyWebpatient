/**
 * EffectivePermsView — Read-only view of effective permissions for a sub-admin
 * Pure UI component
 */
import { useState } from 'react';
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, Chip, CircularProgress, Box, Typography,
    Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';

const ACTION_KEYS = ['can_view', 'can_create', 'can_edit', 'can_delete',
    'can_l1_verify', 'can_l2_verify', 'can_l3_verify', 'can_lock', 'can_unlock'];

// Mapping modules to categories
const MODULE_GROUPS = {
    'Login & Signup': [
        'login_page_config', 'patient_login_page', 'doctor_login_page', 
        'admin_login_page', 'patient_signup_page', 'doctor_signup_page', 
        'pharmacy_signup_page', 'diagnosis_signup_page'
    ],
    'Patient Management': [
        'patient_list', 'patient_profile', 'patient_personal_info', 
        'patient_health_records', 'patient_insurance', 'patient_emergency_contact', 
        'patient_house_group', 'patient_documents', 'patient_question_answers'
    ],
    'Doctor Management': [
        'doctor_list', 'doctor_profile', 'doctor_personal_info', 
        'doctor_professional_info', 'doctor_qualifications', 'doctor_specializations', 
        'doctor_services', 'doctor_hospital_affiliations', 'doctor_availability_slots', 
        'doctor_consultation_fee', 'doctor_verification', 'doctor_questions'
    ],
    'Appointment Management': [
        'appointment_list', 'appointment_details', 'appointment_scheduling', 
        'appointment_cancellation', 'appointment_symptoms', 'appointment_ratings', 
        'appointment_documents', 'appointment_follow_ups'
    ],
    'Consultations': [
        'consultation_list', 'consultation_chat', 'consultation_attachments', 
        'consultation_status'
    ],
    'Prescriptions/Pharmacy': [
        'prescription_list', 'prescription_details', 'prescription_medicines',
        'pharmacy_list', 'pharmacy_profile', 'pharmacy_verification',
        'medicine_list', 'medicine_brands'
    ],
    'Hospital/Masters': [
        'hospital_list', 'hospital_profile', 'category_management', 
        'symptom_management', 'questionnaire_blocks'
    ],
    'Admin & System': [
        'admin_list', 'admin_roles', 'admin_permissions', 'sub_admin_management',
        'approval_requests', 'approval_processing', 'system_settings', 'audit_logs'
    ],
    'Reports': [
        'reports_dashboard', 'reports_patients', 'reports_doctors', 
        'reports_appointments', 'reports_revenue'
    ]
};

const EffectivePermsView = ({ permissions, isLoading }) => {
    // State to control all accordions (optional, could be per-accordion)
    // Defaulting to all expanded or first one expanded? Let's keep them collapsed or open?
    // User asked for "hide table and view full", implies collapsible.
    
    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    const modules = permissions && typeof permissions === 'object' ? Object.entries(permissions) : [];

    if (modules.length === 0) {
        return (
            <Typography color="text.secondary" variant="body2">
                No effective permissions data available.
            </Typography>
        );
    }

    // Grouping logic
    const groupedModules = {};
    const unassignedModules = [];

    modules.forEach(([modName, perms]) => {
        let assigned = false;
        for (const [group, groupMods] of Object.entries(MODULE_GROUPS)) {
            if (groupMods.includes(modName)) {
                if (!groupedModules[group]) groupedModules[group] = [];
                groupedModules[group].push([modName, perms]);
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            unassignedModules.push([modName, perms]);
        }
    });

    if (unassignedModules.length > 0) {
        groupedModules['Other'] = unassignedModules;
    }

    // Sort function for groups
    const sortModules = (moduleList) => {
        return moduleList.sort((a, b) => {
            const [, permsA] = a;
            const [, permsB] = b;
            
            // Check if any action is active
            const hasActiveA = ACTION_KEYS.some(key => permsA[key] === true);
            const hasActiveB = ACTION_KEYS.some(key => permsB[key] === true);
            
            if (hasActiveA && !hasActiveB) return -1;
            if (!hasActiveA && hasActiveB) return 1;
            
            return a[0].localeCompare(b[0]);
        });
    };

    return (
        <Box>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Effective Permissions
            </Typography>

            {Object.entries(groupedModules).map(([groupName, groupMods]) => {
                const sortedGroupMods = sortModules(groupMods);
                const activeCount = sortedGroupMods.filter(([, p]) => ACTION_KEYS.some(k => p[k])).length;
                
                return (
                    <Accordion key={groupName} defaultExpanded={activeCount > 0} disableGutters sx={{ mb: 1, border: '1px solid #e0e0e0', borderRadius: 1, '&:before': { display: 'none' } }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={600} sx={{ flexShrink: 0, width: '33%' }}>
                                {groupName}
                            </Typography>
                            <Typography color="text.secondary" sx={{ fontSize: '0.875rem' }}>
                                {activeCount > 0 ? `${activeCount} active` : 'No active permissions'}
                            </Typography>
                        </AccordionSummary>
                        <AccordionDetails sx={{ p: 0 }}>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow sx={{ backgroundColor: '#f8f9fa' }}>
                                            <TableCell sx={{ fontWeight: 700, minWidth: 200 }}>Module</TableCell>
                                            {ACTION_KEYS.map((key) => (
                                                <TableCell key={key} align="center" sx={{ fontWeight: 700, fontSize: '0.75rem', p: 0.5 }}>
                                                    {key.replace('can_', '').replace(/_/g, ' ').toUpperCase().replace('VERIFY', 'VER')}
                                                </TableCell>
                                            ))}
                                            <TableCell sx={{ fontWeight: 700 }}>Data Range</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {sortedGroupMods.map(([module, perms]) => (
                                            <TableRow key={module} hover>
                                                <TableCell sx={{ fontWeight: 500 }}>
                                                    {module.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                                                </TableCell>
                                                {ACTION_KEYS.map((key) => (
                                                    <TableCell key={key} align="center" sx={{ p: 0.5 }}>
                                                        {perms[key] ? (
                                                            <CheckCircleIcon sx={{ fontSize: 16, color: '#16a34a' }} />
                                                        ) : (
                                                            <CancelIcon sx={{ fontSize: 16, color: '#e5e7eb' }} />
                                                        )}
                                                    </TableCell>
                                                ))}
                                                <TableCell>
                                                    <Chip
                                                        label={perms.data_range || 'ALL'}
                                                        size="small"
                                                        sx={{ fontSize: '0.7rem', height: 20 }}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </AccordionDetails>
                    </Accordion>
                );
            })}
        </Box>
    );
};

export default EffectivePermsView;
