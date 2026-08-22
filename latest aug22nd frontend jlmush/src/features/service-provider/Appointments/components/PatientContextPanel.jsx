import React from 'react';
import { Button } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { useDoctorScope } from '../../ProfileSetting/context/DoctorScopeContext';

/**
 * Simple button that opens the full Patient Context page in a new tab.
 *
 * The destination is built from the active {@link useDoctorScope} base path:
 * ``/dashboard/doctor/...`` for a doctor (unchanged), or the Operations
 * member-detail subtree for a super-admin acting on that doctor's behalf,
 * where the same page is mounted. Hard-coding the doctor path would have sent
 * an admin to a route their role can't enter.
 */
const PatientContextPanel = ({ appointmentId }) => {
    const { basePath } = useDoctorScope();

    const handleOpen = () => {
        // Open in new browser tab
        window.open(`${basePath}/appointments/${appointmentId}/patient-context`, '_blank');
    };

    return (
        <Button
            variant="outlined"
            size="small"
            startIcon={<PersonIcon />}
            endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
            onClick={handleOpen}
            sx={{ textTransform: 'none', mt: 1 }}
        >
            View Patient Details & Medical Context
        </Button>
    );
};

export default PatientContextPanel;
