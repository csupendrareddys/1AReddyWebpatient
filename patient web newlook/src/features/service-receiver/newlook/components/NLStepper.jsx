/**
 * NLStepper — port of the mobile MVP's ``Stepper``: the numbered rail both
 * booking flows run on. A completed step stays clickable so the patient can go
 * back and change an answer; a step ahead of the current one is only reachable
 * once the current step is satisfied.
 */
import { Box, ButtonBase, Typography } from '@mui/material';
import NLIcon from './NLIcon';
import { colors, typography } from '../theme/tokens';

const NLStepper = ({ steps = [], current = 0, onStep, canNext = true }) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2.5 }}>
        {steps.map((label, i) => {
            const done = i < current;
            const active = i === current;
            // Forward moves need the current step satisfied; back is always free.
            const reachable = i <= current || (i === current + 1 && canNext);
            return (
                <Box key={label} sx={{ display: 'flex', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                    <ButtonBase
                        onClick={reachable && onStep ? () => onStep(i) : undefined}
                        disabled={!reachable || !onStep}
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '5px',
                            px: '4px',
                            minWidth: 0,
                            opacity: reachable ? 1 : 0.45,
                        }}
                    >
                        <Box
                            sx={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                bgcolor: done || active ? colors.primary : colors.surface,
                                border: `2px solid ${done || active ? colors.primary : colors.border}`,
                                flexShrink: 0,
                            }}
                        >
                            {done ? (
                                <NLIcon name="checkmark" size={15} color={colors.white} />
                            ) : (
                                <Typography
                                    sx={{
                                        fontSize: 12,
                                        fontWeight: 800,
                                        color: active ? colors.white : colors.textMuted,
                                    }}
                                >
                                    {i + 1}
                                </Typography>
                            )}
                        </Box>
                        <Typography
                            sx={{
                                ...typography.caption,
                                fontWeight: active ? 700 : 500,
                                color: active ? colors.primary : colors.textMuted,
                                textAlign: 'center',
                                lineHeight: 1.2,
                            }}
                        >
                            {label}
                        </Typography>
                    </ButtonBase>
                    {i < steps.length - 1 ? (
                        <Box
                            sx={{
                                flex: 1,
                                height: 2,
                                mt: '13px',
                                bgcolor: done ? colors.primary : colors.border,
                                minWidth: 8,
                            }}
                        />
                    ) : null}
                </Box>
            );
        })}
    </Box>
);

export default NLStepper;
