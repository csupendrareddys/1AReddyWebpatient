import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

const STATUS_CONFIG = {
    pending: {
        label: 'Waiting for Approval',
        color: 'warning',
        icon: <HourglassEmptyIcon />,
    },
    approved: {
        label: 'Approved',
        color: 'success',
        icon: <CheckCircleIcon />,
    },
    rejected: {
        label: 'Rejected',
        color: 'error',
        icon: <CancelIcon />,
    },
    query: {
        label: 'Query Raised',
        color: 'info',
        icon: <HelpOutlineIcon />,
    },
};

const ApprovalChip = ({ status, size = 'small', sx = {}, pendingValue = null }) => {
    if (!status || !STATUS_CONFIG[status]) return null;

    const config = STATUS_CONFIG[status];
    // When a change is awaiting review, the field itself still shows the old
    // (approved) value — surface the requested new value here so the user sees
    // both: what's live, and what they've asked to change it to.
    const showPending = (status === 'pending' || status === 'query')
        && pendingValue !== null && pendingValue !== undefined && pendingValue !== '';
    const label = showPending ? `${config.label}: ${pendingValue}` : config.label;

    const chip = (
        <Chip
            icon={config.icon}
            label={label}
            color={config.color}
            size={size}
            variant="outlined"
            sx={{ ml: 1, maxWidth: 320, ...sx }}
        />
    );

    return showPending
        ? <Tooltip title={`Requested new value: ${pendingValue} (awaiting admin approval)`}>{chip}</Tooltip>
        : chip;
};

export default React.memo(ApprovalChip);
