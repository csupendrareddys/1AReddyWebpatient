/**
 * IconKeyField — text input for an ``icon_key`` with a live preview of
 * the icon the typed name resolves to.
 *
 * The preview sits in the input's start adornment and updates as you
 * type, so a typo is obvious before saving rather than after the icon
 * silently fails to appear on the public page. Four states:
 *
 *   empty      → muted placeholder glyph, no error
 *   loading    → spinner while the icons barrel chunk is in flight
 *   resolved   → the icon itself
 *   unknown    → error styling + "No MUI icon named …" helper text
 *
 * "Unknown" is surfaced but NOT blocking — the caller's Save button
 * stays enabled. A bad key costs a missing icon, not a broken page, and
 * hard-blocking on a client-side name check would be a lie the moment
 * MUI ships a new icon.
 *
 * Text state is local so the preview tracks keystrokes; ``value`` seeds
 * it on mount only. Remount with a ``key`` if the caller needs to force
 * a re-sync from the server (the config editors already do this).
 */
import { useState } from 'react';
import { Box, CircularProgress, TextField } from '@mui/material';
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined';
import { useMuiIcon } from '../MuiIcon/MuiIcon';

const HELPER = 'MUI icon name, e.g. LocalHospital. Rendered on the public page.';

/** The adornment box — fixed width so the input doesn't jog between states. */
const IconPreview = ({ name }) => {
    const { Icon, loading, resolved } = useMuiIcon(name);
    return (
        <Box
            sx={{
                width: 24, height: 24, mr: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
            }}
        >
            {loading && <CircularProgress size={16} />}
            {!loading && resolved && <Icon fontSize="small" color="action" />}
            {!loading && !resolved && (
                <ImageNotSupportedOutlinedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
            )}
        </Box>
    );
};

const IconKeyField = ({
    value,
    onChange,
    onBlur,
    label = 'Icon key',
    placeholder = 'e.g. LocalHospital',
    helperText,
    error,
    disabled,
    size = 'small',
    fullWidth = true,
}) => {
    const [text, setText] = useState(value || '');
    const { loading, resolved } = useMuiIcon(text);

    const trimmed = text.trim();
    const unknown = Boolean(trimmed) && !loading && !resolved;

    const handleChange = (e) => {
        setText(e.target.value);
        onChange?.(e.target.value);
    };

    return (
        <TextField
            label={label}
            value={text}
            onChange={handleChange}
            onBlur={onBlur}
            disabled={disabled}
            size={size}
            fullWidth={fullWidth}
            placeholder={placeholder}
            // A caller-supplied error (e.g. a 422 on icon_key) outranks our
            // local name check — the server is authoritative.
            error={Boolean(error) || unknown}
            helperText={
                helperText
                || (unknown ? `No MUI icon named "${trimmed}". It won't render until this matches.` : HELPER)
            }
            slotProps={{
                input: {
                    startAdornment: <IconPreview name={text} />,
                },
            }}
        />
    );
};

export default IconKeyField;
