/**
 * PatientRecords — "My Prescriptions / Documents" as one page with a top
 * toggle, mirroring the doctor side and the "Appointments / Service List"
 * pattern. One sidebar entry, two tabbed views.
 */
import { useSearchParams } from 'react-router-dom';
import { Box, ToggleButtonGroup, ToggleButton } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';

import PatientPrescriptions from '../PatientPrescriptions/PatientPrescriptions';
import PatientDocuments from '../PatientDocuments/PatientDocuments';

const PatientRecords = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const view = searchParams.get('view') === 'documents' ? 'documents' : 'prescriptions';

    const handleChange = (_, next) => {
        if (!next) return;
        setSearchParams(next === 'documents' ? { view: 'documents' } : {}, { replace: true });
    };

    return (
        <Box>
            <Box sx={{ px: 3, pt: 3 }}>
                <ToggleButtonGroup value={view} exclusive onChange={handleChange} color="primary" size="small">
                    <ToggleButton value="prescriptions">
                        <DescriptionIcon fontSize="small" sx={{ mr: 1 }} /> Prescriptions
                    </ToggleButton>
                    <ToggleButton value="documents">
                        <ArticleOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> Documents
                    </ToggleButton>
                </ToggleButtonGroup>
            </Box>
            {view === 'prescriptions' ? <PatientPrescriptions /> : <PatientDocuments />}
        </Box>
    );
};

export default PatientRecords;
