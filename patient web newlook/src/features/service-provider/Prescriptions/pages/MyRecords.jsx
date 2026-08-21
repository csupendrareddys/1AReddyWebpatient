/**
 * MyRecords — "My Prescriptions / Documents" as one page with a top toggle,
 * mirroring the "Appointments / Service List" pattern.
 *
 * Prescriptions and documents are siblings (the only difference is that a
 * document may be a manually-uploaded PDF), so they share one sidebar entry
 * and switch via a ToggleButtonGroup instead of two separate menu items.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, ToggleButtonGroup, ToggleButton } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';

import MyPrescriptionsPage from './MyPrescriptionsPage';
import MyDocumentsPage from '../../Documents/pages/MyDocumentsPage';

/** ``embedded`` drops the outer padding — the Operations detail screen that
 *  mounts this already names the doctor and the tab above it. */
const MyRecords = ({ embedded = false, initialView }) => {
    const [searchParams, setSearchParams] = useSearchParams();
    // ``initialView`` is for the Operations subtree, which gives each half its
    // own route (``/records/documents``) instead of a query param, so that a
    // sub-page's "back to list" lands on the right toggle.
    const view = (searchParams.get('view') || initialView) === 'documents'
        ? 'documents' : 'prescriptions';

    const handleChange = (_, next) => {
        if (!next) return;
        setSearchParams(next === 'documents' ? { view: 'documents' } : {}, { replace: true });
    };

    return (
        <Box>
            <Box sx={{ px: embedded ? 0 : 3, pt: embedded ? 0 : 3 }}>
                <ToggleButtonGroup value={view} exclusive onChange={handleChange} color="primary" size="small">
                    <ToggleButton value="prescriptions">
                        <DescriptionIcon fontSize="small" sx={{ mr: 1 }} /> Prescriptions
                    </ToggleButton>
                    <ToggleButton value="documents">
                        <ArticleOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> Documents
                    </ToggleButton>
                </ToggleButtonGroup>
            </Box>
            {view === 'prescriptions' ? <MyPrescriptionsPage /> : <MyDocumentsPage />}
        </Box>
    );
};

export default MyRecords;
