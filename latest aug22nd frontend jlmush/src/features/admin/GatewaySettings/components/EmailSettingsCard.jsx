/**
 * Email — sender identity + per-purpose templates.
 *
 * The email counterpart of the SMS/DLT card, kept as its own component so
 * GatewaySettings doesn't grow a third inline section.
 *
 * Two things read differently from SMS, and the copy leans on both:
 *
 *  * Templates are editable as soon as the plan allows, but the FROM ADDRESS
 *    only goes live once we've confirmed the domain in the mail provider.
 *    So the switch and the template table are gated separately — a tenant can
 *    rewrite their wording while their domain is still being checked.
 *  * Changing the address clears that confirmation server-side, so the UI
 *    says so before they save rather than leaving them wondering why sending
 *    reverted to the platform address.
 */
import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent,
    DialogContentText, DialogTitle, Divider, Paper, Stack, Switch, Table,
    TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
    Typography,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';

import usePrimedQuery from '../../../../common/hooks/usePrimedQuery';
import {
    useGetEmailConfigQuery,
    useSaveEmailConfigMutation,
} from '../../api/gatewayEndpoints';

const errText = (e) => e?.data?.error || e?.data?.message
    || 'Something went wrong. Please try again.';

export default function EmailSettingsCard({ flash, busy: parentBusy }) {
    const emailQ = useGetEmailConfigQuery();
    const { data: cfg, reprime } = usePrimedQuery(emailQ);
    const [saveEmail, saveState] = useSaveEmailConfigMutation();

    const [draft, setDraft] = useState({ from_email: null, from_name: null, reply_to: null });
    const [tplOpen, setTplOpen] = useState(null);
    const [tplDraft, setTplDraft] = useState({});

    const busy = parentBusy || saveState.isLoading;
    const allowed = !!cfg?.custom_email_allowed;
    const purposes = useMemo(() => cfg?.common_purposes || [], [cfg]);
    const overrides = useMemo(() => cfg?.templates || {}, [cfg]);

    // The address the user is about to save, vs the one already confirmed.
    const pendingAddress = draft.from_email ?? (cfg?.from_email || '');
    const addressChanged = pendingAddress !== (cfg?.from_email || '');

    const onToggle = async (checked) => {
        try {
            await saveEmail({ use_own_email: checked }).unwrap();
            reprime();
            flash('success', checked
                ? 'Your own email identity is on.'
                : 'Back to the shared email templates.');
        } catch (e) { flash('error', errText(e)); }
    };

    const onSaveSender = async () => {
        try {
            await saveEmail({
                from_email: draft.from_email ?? cfg?.from_email ?? '',
                from_name: draft.from_name ?? cfg?.from_name ?? '',
                reply_to: draft.reply_to ?? cfg?.reply_to ?? '',
            }).unwrap();
            reprime();
            setDraft({ from_email: null, from_name: null, reply_to: null });
            flash('success', 'Sender details saved.');
        } catch (e) { flash('error', errText(e)); }
    };

    const onSaveTemplate = async (purpose) => {
        try {
            await saveEmail({ templates: { [purpose]: {
                subject: tplDraft[purpose]?.subject,
                body_template: tplDraft[purpose]?.body_template,
            } } }).unwrap();
            reprime();
            setTplOpen(null);
            flash('success', 'Template saved.');
        } catch (e) { flash('error', errText(e)); }
    };

    const onRemoveTemplate = async (purpose) => {
        try {
            await saveEmail({ templates: { [purpose]: null } }).unwrap();
            reprime();
            flash('success', 'Back to the shared template for this message.');
        } catch (e) { flash('error', errText(e)); }
    };

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
                <EmailIcon fontSize="small" color="action" />
                <Typography variant="h6">Email — sender &amp; templates</Typography>
                <Chip size="small"
                    label={cfg?.ready ? 'sending as you'
                        : cfg?.use_own_email ? 'awaiting domain check' : 'shared'}
                    color={cfg?.ready ? 'success' : cfg?.use_own_email ? 'warning' : 'default'}
                    variant="outlined" />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                By default email goes out from the platform address with your
                organisation's name in the message. You can rewrite any message
                and send from your own domain instead.
            </Typography>

            {!allowed && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                    Your current plan uses the shared email templates. Upgrade to
                    write your own and send from your own domain.
                </Alert>
            )}

            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                <Switch checked={!!cfg?.use_own_email}
                    disabled={!allowed || busy}
                    onChange={(e) => onToggle(e.target.checked)} />
                <Typography variant="body2">Use my own email identity</Typography>
            </Stack>

            {cfg?.use_own_email && (
                <Stack spacing={2}>
                    {!cfg?.domain_verified && pendingAddress && !addressChanged && (
                        <Alert severity="warning">
                            We still need to verify <b>{pendingAddress}</b> with the
                            mail provider. Until then your email keeps going out
                            from the platform address — nothing is lost, it just
                            isn't branded yet.
                        </Alert>
                    )}
                    {addressChanged && pendingAddress && (
                        <Alert severity="info">
                            Saving a new address restarts the domain check, so
                            sending returns to the platform address until we
                            confirm it.
                        </Alert>
                    )}

                    <TextField size="small" label="Send from"
                        placeholder="e.g. care@yourclinic.com"
                        value={pendingAddress}
                        onChange={(e) => setDraft((d) => ({ ...d, from_email: e.target.value }))} />
                    <TextField size="small" label="Sender name"
                        placeholder="e.g. Acme Health"
                        value={draft.from_name ?? (cfg?.from_name || '')}
                        onChange={(e) => setDraft((d) => ({ ...d, from_name: e.target.value }))} />
                    <TextField size="small" label="Reply-to (optional)"
                        placeholder="where replies should land"
                        value={draft.reply_to ?? (cfg?.reply_to || '')}
                        onChange={(e) => setDraft((d) => ({ ...d, reply_to: e.target.value }))} />
                    <Box>
                        <Button variant="contained" disabled={busy} onClick={onSaveSender}>
                            Save sender details
                        </Button>
                    </Box>

                    <Divider />
                    <Typography variant="subtitle2">
                        Message templates ({Object.keys(overrides).length} of{' '}
                        {purposes.length} rewritten — the rest use the shared wording)
                    </Typography>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Message</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell align="right" />
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {purposes.map((p) => {
                                    const ov = overrides[p.purpose];
                                    return (
                                        <TableRow key={p.purpose}>
                                            <TableCell>
                                                <Typography variant="body2">{p.name}</Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {p.purpose}
                                                    {p.variable_names?.length
                                                        ? ` · vars: ${p.variable_names.join(', ')}` : ''}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Chip size="small"
                                                    label={ov ? 'yours' : 'shared'}
                                                    color={ov ? 'success' : 'default'}
                                                    variant="outlined" />
                                            </TableCell>
                                            <TableCell align="right">
                                                <Button size="small" onClick={() => {
                                                    setTplDraft((d) => ({ ...d, [p.purpose]: {
                                                        subject: ov?.subject || p.common_subject || '',
                                                        body_template: ov?.body_template || p.common_body || '',
                                                    } }));
                                                    setTplOpen(p.purpose);
                                                }}>
                                                    {ov ? 'Edit' : 'Rewrite'}
                                                </Button>
                                                {ov && (
                                                    <Button size="small" color="warning" disabled={busy}
                                                        onClick={() => onRemoveTemplate(p.purpose)}>
                                                        Reset
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Stack>
            )}

            <Dialog open={!!tplOpen} onClose={() => setTplOpen(null)} fullWidth maxWidth="sm">
                <DialogTitle>Email — {tplOpen}</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        Keep the {'{variable}'} placeholders exactly as they are —
                        they're filled in when the message is sent. Unlike SMS,
                        the wording here is yours to choose freely.
                    </DialogContentText>
                    <Stack spacing={2}>
                        <TextField size="small" label="Subject"
                            value={tplDraft[tplOpen]?.subject || ''}
                            onChange={(e) => setTplDraft((d) => ({ ...d,
                                [tplOpen]: { ...d[tplOpen], subject: e.target.value } }))} />
                        <TextField size="small" multiline minRows={6}
                            label="Body (HTML allowed)"
                            value={tplDraft[tplOpen]?.body_template || ''}
                            onChange={(e) => setTplDraft((d) => ({ ...d,
                                [tplOpen]: { ...d[tplOpen], body_template: e.target.value } }))} />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTplOpen(null)}>Cancel</Button>
                    <Button variant="contained" disabled={busy}
                        onClick={() => onSaveTemplate(tplOpen)}>
                        Save template
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
}
