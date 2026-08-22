/**
 * LanguageSelector — compact dropdown for picking the current UI language.
 *
 * Renders nothing when ``availableLanguages`` has fewer than 2 entries (a
 * tenant publishing a single language doesn't need the control visible).
 *
 * Props
 *  - value: selected language code
 *  - onChange: fn(code) invoked when the user picks one
 *  - availableLanguages: string[] of language codes the caller considers valid
 *    (typically the page's ``published_languages`` list). When omitted, falls
 *    back to every supported language.
 *  - size: 'small' | 'medium' (default 'small')
 */
import { IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import { useState } from 'react';
import { getLanguageLabel, SUPPORTED_LANGUAGES } from './languages';

const LanguageSelector = ({ value, onChange, availableLanguages, size = 'small' }) => {
    const [anchorEl, setAnchorEl] = useState(null);

    const codes = availableLanguages && availableLanguages.length
        ? availableLanguages
        : SUPPORTED_LANGUAGES.map((l) => l.code);

    if (codes.length < 2) return null;

    const open = Boolean(anchorEl);
    const handleOpen = (e) => setAnchorEl(e.currentTarget);
    const handleClose = () => setAnchorEl(null);
    const handlePick = (code) => {
        onChange?.(code);
        setAnchorEl(null);
    };

    return (
        <>
            <Tooltip title="Change Language">
                <IconButton onClick={handleOpen} color="primary" size={size}>
                    <LanguageIcon />
                    <Typography variant="caption" sx={{ ml: 0.5, fontWeight: 600 }}>
                        {getLanguageLabel(value)}
                    </Typography>
                </IconButton>
            </Tooltip>
            <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
                {codes.map((code) => (
                    <MenuItem
                        key={code}
                        selected={code === value}
                        onClick={() => handlePick(code)}
                    >
                        {getLanguageLabel(code)}
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};

export default LanguageSelector;
