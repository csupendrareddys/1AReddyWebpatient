/**
 * BenefitsEditor — ordered list of free-text selling points shown on a
 * service-receiver (patient) plan card.
 *
 * Receiver plans have no add-ons and no structured feature tree — a
 * patient buys a list of promises, not a permission matrix. So this is
 * deliberately unstructured: whatever the operator types is what the
 * public card renders, in this order.
 *
 * Value is a plain array of strings. Blank rows are kept while editing
 * (so a freshly-added row doesn't vanish under the cursor) and dropped
 * on save by ``usePricingAdmin``.
 */
import { Button, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';


const BenefitsEditor = ({ value, onChange }) => {
    const rows = Array.isArray(value) ? value : [];

    const setRow = (i, text) =>
        onChange(rows.map((r, idx) => (idx === i ? text : r)));

    const addRow = () => onChange([...rows, '']);

    const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));

    const moveRow = (i, delta) => {
        const target = i + delta;
        if (target < 0 || target >= rows.length) return;
        const next = [...rows];
        [next[i], next[target]] = [next[target], next[i]];
        onChange(next);
    };

    return (
        <Stack spacing={1}>
            {rows.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                    No benefits yet — the plan card will render an empty list.
                </Typography>
            )}

            {rows.map((row, i) => (
                // Index key: rows are positional and reordering rewrites
                // every value anyway, so there is no stabler identity here.
                // eslint-disable-next-line react/no-array-index-key
                <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                    <TextField
                        size="small"
                        fullWidth
                        placeholder={`Benefit ${i + 1}, e.g. "Unlimited consultations"`}
                        value={row}
                        onChange={(e) => setRow(i, e.target.value)}
                    />
                    <Tooltip title="Move up">
                        <span>
                            <IconButton
                                size="small"
                                disabled={i === 0}
                                onClick={() => moveRow(i, -1)}
                            >
                                <ArrowUpwardIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="Move down">
                        <span>
                            <IconButton
                                size="small"
                                disabled={i === rows.length - 1}
                                onClick={() => moveRow(i, 1)}
                            >
                                <ArrowDownwardIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="Remove">
                        <IconButton size="small" color="error" onClick={() => removeRow(i)}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            ))}

            <Stack direction="row">
                <Button size="small" startIcon={<AddIcon />} onClick={addRow}>
                    Add benefit
                </Button>
            </Stack>
        </Stack>
    );
};


export default BenefitsEditor;
