/**
 * FeatureBulletsEditor — ordered list of provider-plan feature bullets,
 * each entered as its own bubble.
 *
 * Two kinds of row share one ordered list:
 *   * Plain bullets — the operator types one into the add field, presses
 *     Enter, and it drops in as a deletable chip.
 *   * Special "fixed-number" bullets — the three platform charges. Their
 *     leading number is pinned (resolved live from the plan's
 *     ``charge1/2/3_type`` + ``_value`` fields, shown as "15%" or "₹25")
 *     and rendered as a read-only prefix; the rest of the line is an
 *     editable message. They can't be deleted here (their presence is
 *     governed by the charge value — set it to 0 / blank to drop the line)
 *     but they reorder freely with the up / down arrows just like plain
 *     bullets.
 *
 * Everything is stored as plain strings in ``features.bullets`` (special
 * ones carry a leading token — see ``fixedFeatures.js``), so the list
 * round-trips through ``onChange`` unchanged and renders in this exact
 * order on the public plan card.
 */
import { useEffect } from 'react';
import { Box, Chip, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import {
    SPECIAL_TOKENS,
    composeSpecialBullet,
    defaultSpecialBullet,
    messageOf,
    tokenActive,
    tokenOf,
    tokenPrefix,
} from '../utils/fixedFeatures';


const FeatureBulletsEditor = ({ value, onChange, plan }) => {
    const rows = Array.isArray(value) ? value : [];

    // Keep the special bullets in sync with the plan's numbers: add one when
    // its number becomes non-zero (seeded with default copy), drop it when
    // the number goes to 0 / blank. Operator edits to the *message* and to
    // *ordering* are left untouched — only presence is reconciled here, and
    // only when it actually differs, so this never fights the operator or
    // loops. New special bullets append to the end; the operator repositions
    // them from there.
    useEffect(() => {
        let next = rows;
        let changed = false;
        SPECIAL_TOKENS.forEach((token) => {
            const present = rows.some((b) => tokenOf(b) === token);
            const active = tokenActive(token, plan);
            if (active && !present) {
                next = [...next, defaultSpecialBullet(token, plan)];
                changed = true;
            } else if (!active && present) {
                next = next.filter((b) => tokenOf(b) !== token);
                changed = true;
            }
        });
        if (changed) onChange(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        plan?.charge1_type, plan?.charge1_value,
        plan?.charge2_type, plan?.charge2_value,
        plan?.charge3_type, plan?.charge3_value,
        value,
    ]);

    const setRow = (i, bullet) =>
        onChange(rows.map((r, idx) => (idx === i ? bullet : r)));

    const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));

    const moveRow = (i, delta) => {
        const target = i + delta;
        if (target < 0 || target >= rows.length) return;
        const next = [...rows];
        [next[i], next[target]] = [next[target], next[i]];
        onChange(next);
    };

    const addPlain = (text) => {
        const t = (text || '').trim();
        if (!t) return;
        onChange([...rows, t]);
    };

    return (
        <Stack spacing={1.5}>
            {rows.map((row, i) => {
                const token = tokenOf(row);
                const controls = (
                    <>
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
                    </>
                );

                if (token) {
                    // Special row: fixed number prefix + editable message.
                    return (
                        // eslint-disable-next-line react/no-array-index-key
                        <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                            <TextField
                                size="small"
                                fullWidth
                                value={messageOf(row)}
                                onChange={(e) =>
                                    setRow(i, composeSpecialBullet(token, e.target.value))
                                }
                                placeholder="add a message after the number…"
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <Chip
                                                size="small"
                                                color="info"
                                                label={tokenPrefix(token, plan)}
                                            />
                                        </InputAdornment>
                                    ),
                                }}
                            />
                            {controls}
                        </Stack>
                    );
                }

                // Plain row: a deletable bubble.
                return (
                    // eslint-disable-next-line react/no-array-index-key
                    <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                        <Chip
                            label={row}
                            onDelete={() => removeRow(i)}
                            sx={{ maxWidth: '100%', flex: 1, justifyContent: 'space-between' }}
                        />
                        {controls}
                    </Stack>
                );
            })}

            {rows.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                    No feature bullets yet — type one below and press Enter.
                </Typography>
            )}

            <Box>
                <TextField
                    size="small"
                    fullWidth
                    placeholder='Type a feature and press Enter, e.g. "Up to 10 patients/day"'
                    defaultValue=""
                    key={rows.length}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            // Keep Enter local to the field so it adds a bubble
                            // instead of submitting the surrounding dialog. The
                            // ``key={rows.length}`` remounts (clears) this field
                            // once the row lands.
                            e.preventDefault();
                            addPlain(e.target.value);
                        }
                    }}
                    onBlur={(e) => addPlain(e.target.value)}
                    helperText="Press Enter to add each feature as its own bubble. Use the arrows to reorder — bullets render in this order on the plan card. The ₹ / % lines come from the three Platform charges above; edit their message here."
                />
            </Box>
        </Stack>
    );
};


export default FeatureBulletsEditor;
