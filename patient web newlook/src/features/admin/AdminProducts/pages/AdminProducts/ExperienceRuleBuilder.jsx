/**
 * ExperienceRuleBuilder — builds a product's experience requirement.
 *
 * The rule is in disjunctive normal form: conditions inside a group are ANDed,
 * groups are ORed. A doctor qualifies if every condition in ANY ONE group holds.
 *
 *   [[{level:'ug', years:2}, {level:'super_speciality', years:2}],
 *    [{level:'pg', years:1}]]
 *
 * means (UG >= 2y AND SS >= 2y) OR (PG >= 1y). The UI states that in words
 * rather than making the admin infer operator precedence — "UG 2y or PG 1y and
 * SS 2y" is genuinely ambiguous written out, so it is never written out.
 *
 * No groups = no requirement = any doctor qualifies.
 */
import React from 'react';
import {
    Box, Typography, Button, Stack, IconButton, MenuItem, TextField, Paper, Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

export const LEVELS = [
    { value: 'ug', label: 'UG' },
    { value: 'pg', label: 'PG' },
    { value: 'super_speciality', label: 'Super-speciality' },
];

const levelLabel = (v) => (LEVELS.find((l) => l.value === v) || {}).label || v;

/** Mirrors describe_experience_rule() on the backend. */
export const describeRule = (rule) => {
    if (!rule || !rule.length) return 'No experience requirement — any doctor qualifies.';
    const parts = rule.map((group) =>
        group.map((c) => `${levelLabel(c.level)} ≥ ${c.years || 0}y`).join(' and ')
    );
    return parts.length > 1 ? parts.map((p) => `(${p})`).join(' or ') : parts[0];
};

const ExperienceRuleBuilder = ({ value = [], onChange }) => {
    const rule = value || [];

    const addGroup = () => onChange([...rule, [{ level: 'ug', years: 1 }]]);
    const removeGroup = (gi) => onChange(rule.filter((_, i) => i !== gi));

    const addCondition = (gi) => {
        // Offer a level this group doesn't already use — the backend rejects a
        // level repeated inside one group, since the stricter one always wins.
        const used = rule[gi].map((c) => c.level);
        const next = LEVELS.find((l) => !used.includes(l.value));
        if (!next) return;
        onChange(rule.map((g, i) => (i === gi ? [...g, { level: next.value, years: 1 }] : g)));
    };

    const removeCondition = (gi, ci) => {
        const group = rule[gi].filter((_, i) => i !== ci);
        // An empty group is a vacuous AND — it would match everyone. Drop it.
        onChange(group.length ? rule.map((g, i) => (i === gi ? group : g)) : rule.filter((_, i) => i !== gi));
    };

    const setCondition = (gi, ci, patch) =>
        onChange(rule.map((g, i) =>
            i === gi ? g.map((c, j) => (j === ci ? { ...c, ...patch } : c)) : g
        ));

    return (
        <Box>
            <Typography variant="subtitle2" gutterBottom>Experience requirement</Typography>

            {!rule.length && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    No requirement — any doctor qualifies. Add a group to require experience.
                </Typography>
            )}

            <Stack spacing={1}>
                {rule.map((group, gi) => (
                    <React.Fragment key={gi}>
                        {gi > 0 && (
                            <Divider>
                                <Typography variant="caption" color="text.secondary">OR</Typography>
                            </Divider>
                        )}
                        <Paper variant="outlined" sx={{ p: 1.5 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Doctor must meet ALL of these
                                </Typography>
                                <IconButton size="small" onClick={() => removeGroup(gi)} aria-label="Remove group">
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Stack>

                            <Stack spacing={1}>
                                {group.map((cond, ci) => {
                                    const usedElsewhere = group.filter((_, j) => j !== ci).map((c) => c.level);
                                    return (
                                        <Stack key={ci} direction="row" spacing={1} alignItems="center">
                                            {ci > 0 && (
                                                <Typography variant="caption" sx={{ minWidth: 28 }} color="text.secondary">
                                                    and
                                                </Typography>
                                            )}
                                            {ci === 0 && <Box sx={{ minWidth: 28 }} />}
                                            <TextField
                                                select size="small" label="Level" value={cond.level}
                                                onChange={(e) => setCondition(gi, ci, { level: e.target.value })}
                                                sx={{ minWidth: 160 }}
                                            >
                                                {LEVELS.map((l) => (
                                                    <MenuItem key={l.value} value={l.value} disabled={usedElsewhere.includes(l.value)}>
                                                        {l.label}
                                                    </MenuItem>
                                                ))}
                                            </TextField>
                                            <TextField
                                                size="small" label="Min years" type="number" value={cond.years}
                                                onChange={(e) => setCondition(gi, ci, { years: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                                inputProps={{ min: 0 }} sx={{ width: 120 }}
                                            />
                                            <IconButton size="small" onClick={() => removeCondition(gi, ci)} aria-label="Remove condition">
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Stack>
                                    );
                                })}
                            </Stack>

                            <Button
                                size="small" startIcon={<AddIcon />} sx={{ mt: 1 }}
                                onClick={() => addCondition(gi)}
                                disabled={group.length >= LEVELS.length}
                            >
                                Add condition
                            </Button>
                        </Paper>
                    </React.Fragment>
                ))}
            </Stack>

            <Button size="small" startIcon={<AddIcon />} onClick={addGroup} sx={{ mt: 1 }}>
                {rule.length ? 'Add alternative (OR)' : 'Add requirement'}
            </Button>

            {!!rule.length && (
                <Paper variant="outlined" sx={{ mt: 1.5, p: 1, bgcolor: 'action.hover' }}>
                    <Typography variant="caption" color="text.secondary">A doctor qualifies if:</Typography>
                    <Typography variant="body2">{describeRule(rule)}</Typography>
                </Paper>
            )}
        </Box>
    );
};

export default ExperienceRuleBuilder;
