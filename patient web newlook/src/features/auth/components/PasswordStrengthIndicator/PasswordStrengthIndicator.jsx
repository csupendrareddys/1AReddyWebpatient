import { Box, LinearProgress, Typography } from '@mui/material';
import { getPasswordStrength, getPasswordStrengthLabel, getPasswordStrengthColor } from '../../utils/validation';

const PasswordStrengthIndicator = ({ password }) => {
    const strength = getPasswordStrength(password);
    const label = getPasswordStrengthLabel(strength);
    const color = getPasswordStrengthColor(strength);
    const progress = (strength / 4) * 100;

    if (!password) return null;

    return (
        <Box sx={{ mt: 1, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                    Password Strength
                </Typography>
                <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
                    {label}
                </Typography>
            </Box>
            <LinearProgress
                variant="determinate"
                value={progress}
                sx={{
                    height: 6,
                    borderRadius: 3,
                    bgcolor: 'grey.200',
                    '& .MuiLinearProgress-bar': {
                        bgcolor: color,
                        borderRadius: 3,
                    },
                }}
            />
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                <StrengthCriteria met={password.length >= 8} text="8+ characters" />
                <StrengthCriteria met={/[A-Z]/.test(password)} text="Uppercase" />
                <StrengthCriteria met={/[a-z]/.test(password)} text="Lowercase" />
                <StrengthCriteria met={/[0-9]/.test(password)} text="Number" />
                <StrengthCriteria met={/[!@#$%^&*(),.?":{}|<>]/.test(password)} text="Special" />
            </Box>
        </Box>
    );
};

const StrengthCriteria = ({ met, text }) => (
    <Typography
        variant="caption"
        sx={{
            px: 1,
            py: 0.25,
            borderRadius: 1,
            bgcolor: met ? 'success.light' : 'grey.200',
            color: met ? 'success.dark' : 'text.secondary',
            fontSize: '0.7rem',
        }}
    >
        {text}
    </Typography>
);

export default PasswordStrengthIndicator;
