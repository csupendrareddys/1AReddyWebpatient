/**
 * The honest banner for pages built on ASSUMED endpoints (see
 * api/assumedEndpoints.js). Shown only when the call failed the way a
 * not-built-yet endpoint fails — a page must never render sample data as if
 * the backend returned it.
 */
import { Alert } from '@mui/material';
import { isMissingEndpoint } from '../api/assumedEndpoints';

const NLAssumedNotice = ({ error, endpoint, children }) => {
    if (!error) return null;
    if (isMissingEndpoint(error)) {
        return (
            <Alert severity="info" sx={{ mb: 2 }}>
                This page is ready but its backend isn&apos;t: it expects{' '}
                <code>{endpoint}</code>, which doesn&apos;t exist yet (the call came
                back unanswered).{' '}
                {children || 'Everything here lights up as soon as that endpoint ships.'}
            </Alert>
        );
    }
    return (
        <Alert severity="error" sx={{ mb: 2 }}>
            Couldn&apos;t load this page&apos;s data. Please try again.
        </Alert>
    );
};

export default NLAssumedNotice;
