/**
 * AnnouncementDialog — the seller→tenant broadcast composer, shared by
 * the vendor console (Tenants page → all/selected direct tenants) and
 * the apex reseller console (My Tenants → all/selected children).
 *
 * The parent owns the mutation: this dialog only shapes the payload
 * ({title, body, audience, tenant_ids}) and closes itself when the
 * parent's onSend resolves truthy. Delivery is a bell notification to
 * each target tenant's admins — tenant end-users never see it.
 */
import { useState } from 'react';
import {
    Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent,
    DialogTitle, FormControlLabel, Radio, RadioGroup, TextField,
    Typography,
} from '@mui/material';

// Mirror of the backend caps (app/common/announcements.py) so the
// composer blocks before the server would.
const TITLE_MAX = 200;
const BODY_MAX = 2000;

export default function AnnouncementDialog({
    open, onClose, tenants = [], audienceAllLabel = 'All tenants',
    onSend, sending = false,
}) {
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [audience, setAudience] = useState('all');
    const [selected, setSelected] = useState([]);

    const reset = () => {
        setTitle(''); setBody(''); setAudience('all'); setSelected([]);
    };
    const handleClose = () => {
        if (sending) return;
        reset();
        onClose();
    };

    const canSend = Boolean(title.trim())
        && title.trim().length <= TITLE_MAX
        && body.length <= BODY_MAX
        && (audience === 'all' || selected.length > 0)
        && !sending;

    const handleSend = async () => {
        const ok = await onSend({
            title: title.trim(),
            body: body.trim() || undefined,
            audience,
            tenant_ids: audience === 'selected'
                ? selected.map((t) => t.id)
                : undefined,
        });
        if (ok) {
            reset();
            onClose();
        }
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>Send announcement</DialogTitle>
            <DialogContent dividers>
                <Alert severity="info" sx={{ mb: 2 }}>
                    Delivered as a bell notification to each tenant&apos;s
                    admins. Their users and customers are not notified.
                </Alert>
                <TextField
                    autoFocus fullWidth margin="dense" label="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    error={title.length > TITLE_MAX}
                    helperText={`${title.trim().length}/${TITLE_MAX}`}
                />
                <TextField
                    fullWidth margin="dense" label="Message (optional)"
                    multiline rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    error={body.length > BODY_MAX}
                    helperText={`${body.length}/${BODY_MAX}`}
                />
                <Typography variant="subtitle2" sx={{ mt: 1 }}>
                    Audience
                </Typography>
                <RadioGroup
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                >
                    <FormControlLabel
                        value="all" control={<Radio size="small" />}
                        label={`${audienceAllLabel} (${tenants.length})`}
                    />
                    <FormControlLabel
                        value="selected" control={<Radio size="small" />}
                        label="Only selected tenants"
                    />
                </RadioGroup>
                {audience === 'selected' && (
                    <Autocomplete
                        multiple size="small" options={tenants}
                        getOptionLabel={(t) => `${t.name} (${t.slug})`}
                        isOptionEqualToValue={(a, b) => a.id === b.id}
                        value={selected}
                        onChange={(e, value) => setSelected(value)}
                        renderInput={(params) => (
                            <TextField
                                {...params} margin="dense"
                                label="Tenants" placeholder="Pick tenants…"
                            />
                        )}
                    />
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={sending}>
                    Cancel
                </Button>
                <Button
                    variant="contained" disabled={!canSend}
                    onClick={handleSend}
                >
                    {sending ? 'Sending…' : 'Send announcement'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
