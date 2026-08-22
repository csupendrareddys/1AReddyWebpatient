import React from 'react';
import { Alert, AlertTitle } from '@mui/material';

const ApprovalBanner = ({ pendingCount = 0, queryCount = 0 }) => {
    if (!pendingCount && !queryCount) return null;

    const parts = [];
    if (pendingCount > 0) {
        parts.push(`${pendingCount} field change(s) waiting for approval`);
    }
    if (queryCount > 0) {
        parts.push(`${queryCount} query/queries raised by admin`);
    }

    return (
        <Alert severity="warning" sx={{ mb: 2 }}>
            <AlertTitle>Pending Approvals</AlertTitle>
            {parts.join(' | ')}
        </Alert>
    );
};

export default React.memo(ApprovalBanner);
