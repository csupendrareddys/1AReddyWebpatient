/**
 * DiscountPicker — one compact pricing-table cell for selecting vouchers or
 * coupons on a row, and for creating one on the spot.
 *
 * Why a popover rather than columns: the pricing table already carries doctor
 * identity, fee, three numeric editors and the display price. Rendering a
 * checkbox per voucher inline would make the table grow a column every time an
 * admin adds a voucher — unbounded width. The cell instead shows only the
 * resulting deduction ("−₹70 · 2"), and the full list opens on click.
 *
 * ── Creating from the row ──
 * A voucher that only exists for one doctor × offering used to mean scrolling
 * past the table to the book below, typing it, scrolling back, finding the row
 * again and ticking it. The popover carries its own one-line creator instead:
 * ``＋ New`` → code, ₹ off, optional label → the discount is written to the
 * book AND ticked on the row it was opened from, in one action. It is the same
 * book either way — anything added here shows up in the books below and can be
 * picked from any other row.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Collapse, Divider, List, ListItemButton,
    ListItemText, Popover, Stack, TextField, ToggleButton, ToggleButtonGroup,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Singular noun for a book, for button labels and placeholders. */
const NOUN = { vouchers: 'voucher', coupons: 'coupon' };

const BLANK = { code: '', label: '', amount: '' };

/**
 * @param {Array}    options    [{ id, code, label, amount, is_active }]
 * @param {string[]} selectedIds
 * @param {Function} onChange   (nextIds: string[]) => void
 * @param {string}   emptyHint  shown when the book itself is empty
 * @param {string[]} createKinds  books this cell may create into, e.g.
 *                   ``['vouchers']``. Two entries render a kind toggle. Omit
 *                   (or pass ``onCreate`` as null) to hide the creator.
 * @param {Function} onCreate   ({kind, code, label, amount}) => Promise<row>.
 *                   Resolves with the created row — the picker ticks its id on
 *                   this row; rejects to surface the message inline.
 */
const DiscountPicker = ({
    options = [], selectedIds = [], onChange, emptyHint,
    createKinds = [], onCreate,
}) => {
    const [anchor, setAnchor] = useState(null);
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState(BLANK);
    const [kind, setKind] = useState(createKinds[0] || 'vouchers');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const canCreate = typeof onCreate === 'function' && createKinds.length > 0;

    const selected = new Set(selectedIds.map(String));
    // Only live rows count toward the deduction — the backend ignores inactive
    // ones, so showing them in the total here would misreport the price.
    const active = options.filter((o) => o.is_active);
    const total = active
        .filter((o) => selected.has(String(o.id)))
        .reduce((sum, o) => sum + Number(o.amount || 0), 0);
    const count = options.filter((o) => selected.has(String(o.id))).length;

    const toggle = (id) => {
        const key = String(id);
        const next = selected.has(key)
            ? selectedIds.filter((s) => String(s) !== key)
            : [...selectedIds, key];
        onChange(next);
    };

    const resetCreator = () => {
        setAdding(false);
        setDraft(BLANK);
        setError(null);
    };

    const close = () => {
        setAnchor(null);
        resetCreator();
    };

    const submitNew = async () => {
        const code = draft.code.trim();
        if (!code) {
            setError('Code is required.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const row = await onCreate({
                kind,
                code,
                label: draft.label.trim(),
                amount: Number(draft.amount) || 0,
            });
            // Tick it here as well as adding it to the book — creating a
            // discount from a row is a statement about THAT row, so making the
            // admin then find and tick it would undo the point of the button.
            if (row?.id) onChange([...selectedIds, String(row.id)]);
            setDraft(BLANK);
            setAdding(false);
        } catch (err) {
            setError(
                err?.data?.error || err?.data?.message || err?.message
                || 'Could not add.',
            );
        } finally {
            setSaving(false);
        }
    };

    const noun = NOUN[kind] || 'discount';

    return (
        <>
            <Button
                size="small"
                variant={count ? 'outlined' : 'text'}
                color={count ? 'primary' : 'inherit'}
                onClick={(e) => setAnchor(e.currentTarget)}
                sx={{
                    minWidth: 78, px: 0.75, textTransform: 'none',
                    fontWeight: count ? 700 : 400,
                    color: count ? undefined : 'text.disabled',
                }}
            >
                {count ? `−${inr(total)} · ${count}` : '—'}
            </Button>

            <Popover
                open={!!anchor}
                anchorEl={anchor}
                onClose={close}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Box sx={{ minWidth: 300, maxWidth: 380 }}>
                    {options.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ p: 2, pb: canCreate ? 1 : 2 }}>
                            {emptyHint}
                        </Typography>
                    ) : (
                        <>
                            <List dense disablePadding sx={{ maxHeight: 300, overflowY: 'auto' }}>
                                {options.map((o) => (
                                    <ListItemButton
                                        key={o.id}
                                        onClick={() => toggle(o.id)}
                                        disabled={!o.is_active}
                                        dense
                                    >
                                        <Checkbox
                                            edge="start"
                                            size="small"
                                            checked={selected.has(String(o.id))}
                                            tabIndex={-1}
                                            disableRipple
                                        />
                                        <ListItemText
                                            primary={
                                                <Stack direction="row" justifyContent="space-between"
                                                    spacing={1}>
                                                    <span>{o.code}</span>
                                                    <strong>−{inr(o.amount)}</strong>
                                                </Stack>
                                            }
                                            secondary={o.is_active
                                                ? (o.label || null)
                                                : 'Inactive — not applied'}
                                        />
                                    </ListItemButton>
                                ))}
                            </List>
                            <Divider />
                            <Stack direction="row" justifyContent="space-between"
                                alignItems="center" sx={{ px: 2, py: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Total deduction
                                </Typography>
                                <Typography variant="body2" fontWeight={700}>
                                    −{inr(total)}
                                </Typography>
                            </Stack>
                        </>
                    )}

                    {canCreate && (
                        <>
                            <Divider />
                            {!adding ? (
                                <Button
                                    fullWidth
                                    size="small"
                                    startIcon={<AddIcon />}
                                    onClick={() => setAdding(true)}
                                    sx={{ textTransform: 'none', justifyContent: 'flex-start', px: 2, py: 1 }}
                                >
                                    {createKinds.length > 1
                                        ? 'New voucher or coupon'
                                        : `New ${NOUN[createKinds[0]] || 'discount'}`}
                                </Button>
                            ) : (
                                <Collapse in appear>
                                    <Box sx={{ p: 1.5, bgcolor: 'action.hover' }}>
                                        <Stack direction="row" alignItems="center"
                                            justifyContent="space-between" sx={{ mb: 1 }}>
                                            <Typography variant="caption" fontWeight={700}
                                                color="text.secondary">
                                                Add a {noun} to this row
                                            </Typography>
                                            <Button
                                                size="small" onClick={resetCreator}
                                                startIcon={<CloseIcon sx={{ fontSize: 14 }} />}
                                                sx={{ textTransform: 'none', minWidth: 0, px: 0.5 }}
                                            >
                                                Cancel
                                            </Button>
                                        </Stack>

                                        {/* Only the per-plan cell picks from both books at
                                            once; the Vouchers / Coupons columns each pass a
                                            single kind and render no toggle. */}
                                        {createKinds.length > 1 && (
                                            <ToggleButtonGroup
                                                size="small" exclusive value={kind}
                                                onChange={(e, v) => v && setKind(v)}
                                                sx={{ mb: 1 }}
                                            >
                                                {createKinds.map((k) => (
                                                    <ToggleButton key={k} value={k}
                                                        sx={{ textTransform: 'none', py: 0.25, px: 1.25 }}>
                                                        {NOUN[k] || k}
                                                    </ToggleButton>
                                                ))}
                                            </ToggleButtonGroup>
                                        )}

                                        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                                            <TextField
                                                size="small" label="Code" autoFocus
                                                placeholder="WELCOME50"
                                                value={draft.code}
                                                onChange={(e) => setDraft(
                                                    (d) => ({ ...d, code: e.target.value }))}
                                                sx={{ flex: 1 }}
                                            />
                                            <TextField
                                                size="small" label="₹ off" type="number"
                                                value={draft.amount}
                                                onChange={(e) => setDraft(
                                                    (d) => ({ ...d, amount: e.target.value }))}
                                                inputProps={{ min: 0 }}
                                                sx={{ width: 96 }}
                                            />
                                        </Stack>
                                        <TextField
                                            size="small" fullWidth label="Label (optional)"
                                            placeholder="Welcome offer"
                                            value={draft.label}
                                            onChange={(e) => setDraft(
                                                (d) => ({ ...d, label: e.target.value }))}
                                            sx={{ mb: 1 }}
                                        />
                                        {error && (
                                            <Alert severity="error" sx={{ mb: 1, py: 0 }}>{error}</Alert>
                                        )}
                                        <Button
                                            fullWidth size="small" variant="contained"
                                            startIcon={<AddIcon />}
                                            onClick={submitNew}
                                            disabled={saving || !draft.code.trim()}
                                            sx={{ textTransform: 'none' }}
                                        >
                                            {saving ? 'Adding…' : `Add & apply to this row`}
                                        </Button>
                                    </Box>
                                </Collapse>
                            )}
                        </>
                    )}
                </Box>
            </Popover>
        </>
    );
};

export default DiscountPicker;
