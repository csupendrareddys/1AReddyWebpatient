import { useState } from 'react';
import {
    Alert, Box, Chip, IconButton, Paper, Stack, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';

/**
 * The DNS records a tenant must publish before their domain will route.
 *
 * Values come straight from the API, which reads them from what Cloudflare
 * and the verification service actually returned — never reconstructed here.
 * A record name assembled client-side would be a record nothing checks, and
 * the tenant would sit waiting on a verification that can never pass.
 *
 * Copy buttons matter more than they look: these values are long opaque
 * tokens, and a hand-retyped one fails verification with no useful error.
 */
export default function DnsRecordsTable({ records = [] }) {
    const [copied, setCopied] = useState(null);

    const copy = async (key, value) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(key);
            setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
        } catch {
            /* clipboard blocked (insecure origin) — the value is still
               selectable in the cell, so this is a convenience, not a
               dependency. */
        }
    };

    if (!records.length) return null;

    return (
        <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Add these records at your DNS provider
            </Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
                DNS changes can take a few minutes to a few hours to spread.
                Your existing portal address keeps working the whole time —
                nothing goes offline while you wait.
            </Alert>
            <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Type</TableCell>
                            <TableCell>Name / Host</TableCell>
                            <TableCell>Value</TableCell>
                            <TableCell>Why</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {records.map((r, i) => (
                            <TableRow key={`${r.name}-${i}`}>
                                <TableCell>
                                    <Chip label={r.type} size="small" />
                                </TableCell>
                                {['name', 'value'].map((field) => (
                                    <TableCell key={field}>
                                        <Stack
                                            direction="row" spacing={0.5}
                                            alignItems="center"
                                        >
                                            <Box
                                                component="code"
                                                sx={{
                                                    fontSize: '0.78rem',
                                                    wordBreak: 'break-all',
                                                }}
                                            >
                                                {r[field]}
                                            </Box>
                                            <Tooltip
                                                title={
                                                    copied === `${i}-${field}`
                                                        ? 'Copied'
                                                        : 'Copy'
                                                }
                                            >
                                                <IconButton
                                                    size="small"
                                                    onClick={() => copy(`${i}-${field}`, r[field])}
                                                >
                                                    {copied === `${i}-${field}`
                                                        ? <CheckIcon fontSize="inherit" />
                                                        : <ContentCopyIcon fontSize="inherit" />}
                                                </IconButton>
                                            </Tooltip>
                                        </Stack>
                                    </TableCell>
                                ))}
                                <TableCell>
                                    <Typography variant="caption" color="text.secondary">
                                        {r.why}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
}
