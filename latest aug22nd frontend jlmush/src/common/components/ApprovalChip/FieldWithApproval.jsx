import React from 'react';
import { Box } from '@mui/material';
import ApprovalChip from './ApprovalChip';

/**
 * Wrapper component that adds an approval status chip next to any form field.
 *
 * Usage:
 *   <FieldWithApproval fieldName="first_name" section="personal_details" fieldStatuses={fieldStatuses}>
 *     <TextField ... />
 *   </FieldWithApproval>
 */
const FieldWithApproval = ({ fieldName, section, fieldStatuses, children }) => {
    const key = section ? `${section}.${fieldName}` : fieldName;
    const statusInfo = fieldStatuses?.[key];
    const status = statusInfo?.status;

    if (!status) {
        return children;
    }

    return (
        <Box sx={{ position: 'relative' }}>
            {children}
            <Box sx={{ mt: 0.5 }}>
                <ApprovalChip status={status} />
            </Box>
        </Box>
    );
};

export default React.memo(FieldWithApproval);
