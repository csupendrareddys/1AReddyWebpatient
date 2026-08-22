/**
 * HealthRecords — patient-facing read-only view of everything in their health
 * profile, laid out as TABLES (Vitals, Habits & Lifestyle, Surgeries, Health
 * Records, Provider Prescriptions, Others). Each section header carries an
 * "Edit" button that deep-links to the matching editor tab under Profile
 * Settings (``/dashboard/patient/profile?section=<key>``) — this page is
 * display-only; editing lives there.
 *
 * A family-member dropdown sits on top (self today; house-group members are a
 * placeholder until per-member sharing is wired).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Chip, Divider, MenuItem, TextField, Button, Stack,
    Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, Link,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import SpaIcon from '@mui/icons-material/Spa';
import HealingIcon from '@mui/icons-material/Healing';
import FolderSharedIcon from '@mui/icons-material/FolderShared';
import DescriptionIcon from '@mui/icons-material/Description';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import {
    useGetVitalsQuery,
    useGetHabitsQuery,
    useGetSurgeriesQuery,
    useGetHealthRecordsQuery,
} from '../../api/patientHealthEndpoints';
import { resolveMediaUrl } from '../../../../common/utils/mediaUrl';

const PROFILE_EDIT_BASE = '/dashboard/patient/profile';

const prettyKey = (k) => String(k)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const isEmpty = (v) => v === null || v === undefined || v === ''
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

// ``details`` is a JSON column — an object ({bp, pulse, temp, ...}), a plain
// string, or absent. Flatten an object into a compact "Key: value · Key: value"
// line (never render an object straight into JSX — that throws "Objects are not
// valid as a React child" and blanks the page); pass strings through.
const detailsText = (details, notes) => {
    if (details && typeof details === 'object') {
        const parts = Object.entries(details)
            .filter(([, v]) => !isEmpty(v) && typeof v !== 'object')
            .map(([k, v]) => `${prettyKey(k)}: ${v}`);
        return parts.join('  ·  ') || (notes || '—');
    }
    return details || notes || '—';
};

function EditButton({ section }) {
    const navigate = useNavigate();
    return (
        <Button size="small" variant="outlined" startIcon={<EditIcon />}
            onClick={() => navigate(`${PROFILE_EDIT_BASE}?section=${section}`)}>
            Edit
        </Button>
    );
}

// Section shell: header (icon + title + count + Edit) over a table body.
const SectionCard = ({ icon, title, count, section, loading, children }) => (
    <Paper variant="outlined" sx={{ mb: 2, borderRadius: 2, overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" spacing={1.25}
            sx={{ px: 2, py: 1.25, bgcolor: 'action.hover' }}>
            {icon}
            <Typography fontWeight={600}>{title}</Typography>
            {count !== undefined && count !== null && (
                <Chip size="small" label={count} sx={{ height: 20 }} />
            )}
            <Box sx={{ flexGrow: 1 }} />
            <EditButton section={section} />
        </Stack>
        <Divider />
        {loading
            ? <Box sx={{ p: 2 }}><CircularProgress size={22} /></Box>
            : children}
    </Paper>
);

// Vitals / Habits are a single object → a 2-column Field/Value table.
const KeyValueTable = ({ data, skip = [] }) => {
    const entries = Object.entries(data || {}).filter(
        ([k, v]) => !skip.includes(k) && !isEmpty(v) && typeof v !== 'object');
    if (!entries.length) {
        return <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>No details recorded.</Typography>;
    }
    return (
        <Table size="small">
            <TableBody>
                {entries.map(([k, v]) => (
                    <TableRow key={k}>
                        <TableCell sx={{ width: '35%', color: 'text.secondary', border: 0 }}>{prettyKey(k)}</TableCell>
                        <TableCell sx={{ fontWeight: 500, border: 0 }}>{String(v)}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};

// List sections (Surgeries, Health Records, Prescriptions, Others) → a table.
const RecordTable = ({ records }) => {
    if (!records?.length) {
        return <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>Nothing recorded.</Typography>;
    }
    return (
        <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Details</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Attachments</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {records.map((r, i) => {
                        const atts = r.attachment_links || r.attachments || [];
                        return (
                            <TableRow key={r.id || i} hover>
                                <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    {prettyKey(r.record_type || r.title || 'Record')}
                                </TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                    {r.record_date ? new Date(r.record_date).toLocaleDateString() : '—'}
                                </TableCell>
                                <TableCell sx={{ color: 'text.secondary', maxWidth: 360 }}>
                                    {detailsText(r.details, r.notes)}
                                </TableCell>
                                <TableCell>
                                    {atts.length ? atts.map((a, ai) => (
                                        <Link key={a.s3_key || ai} href={resolveMediaUrl(a.url || a.file_url)}
                                            target="_blank" rel="noopener"
                                            sx={{ display: 'block', fontSize: 13, whiteSpace: 'nowrap' }}>
                                            {a.description || a.filename || a.name || 'Attachment'}
                                        </Link>
                                    )) : '—'}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </Box>
    );
};

const HealthRecords = () => {
    const [member, setMember] = useState('self');

    const { data: vitals, isLoading: vLoading } = useGetVitalsQuery();
    const { data: habits, isLoading: hLoading } = useGetHabitsQuery();
    const { data: surgeries, isLoading: sLoading } = useGetSurgeriesQuery();
    const { data: recordsResp, isLoading: rLoading } = useGetHealthRecordsQuery({ perPage: 100 });

    const allRecords = recordsResp?.health_records || recordsResp?.records || (Array.isArray(recordsResp) ? recordsResp : []);
    const prescriptions = allRecords.filter((r) => r.record_type === 'prescription');
    const generalTypes = ['lab_report', 'imaging', 'vaccination', 'diagnosis', 'consultation', 'discharge_summary'];
    const generalRecords = allRecords.filter((r) => generalTypes.includes(r.record_type));
    const otherRecords = allRecords.filter(
        (r) => !['prescription', 'surgery_record'].includes(r.record_type) && !generalTypes.includes(r.record_type));

    const surgeryList = surgeries?.surgeries || surgeries?.items || (Array.isArray(surgeries) ? surgeries : []);
    const skipMeta = ['id', 'patient_id', 'created_at', 'updated_at', 'tenant_id'];

    return (
        <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 2 }}>
                <Box>
                    <Typography variant="h5" fontWeight={700}>Health Records</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Your complete health profile — vitals, lifestyle, surgeries, records and prescriptions.
                        Use <b>Edit</b> on any section to update it.
                    </Typography>
                </Box>
                <TextField
                    select size="small" label="Viewing" value={member}
                    onChange={(e) => setMember(e.target.value)} sx={{ minWidth: 200 }}
                    helperText="Family members — coming soon"
                >
                    <MenuItem value="self">Myself</MenuItem>
                    <MenuItem value="__family" disabled>Family members (coming soon)</MenuItem>
                </TextField>
            </Box>
            <Divider sx={{ mb: 2 }} />

            <SectionCard icon={<MonitorHeartIcon color="error" />} title="Vitals" section="vitals" loading={vLoading}>
                <KeyValueTable data={vitals} skip={skipMeta} />
            </SectionCard>

            <SectionCard icon={<SpaIcon color="success" />} title="Habits & Lifestyle" section="habits" loading={hLoading}>
                <KeyValueTable data={habits} skip={skipMeta} />
            </SectionCard>

            <SectionCard icon={<HealingIcon color="warning" />} title="Surgeries" count={surgeryList.length} section="surgeries" loading={sLoading}>
                <RecordTable records={surgeryList} />
            </SectionCard>

            <SectionCard icon={<FolderSharedIcon color="primary" />} title="Health Records" count={generalRecords.length} section="health_records" loading={rLoading}>
                <RecordTable records={generalRecords} />
            </SectionCard>

            <SectionCard icon={<DescriptionIcon color="info" />} title="Provider Prescriptions" count={prescriptions.length} section="previous_prescriptions" loading={rLoading}>
                <RecordTable records={prescriptions} />
            </SectionCard>

            <SectionCard icon={<Inventory2Icon color="disabled" />} title="Others" count={otherRecords.length} section="health_records" loading={rLoading}>
                <RecordTable records={otherRecords} />
            </SectionCard>
        </Box>
    );
};

export default HealthRecords;
