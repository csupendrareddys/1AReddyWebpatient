/**
 * SignupSuccess — the "you're in, here's what happens next" screen.
 *
 * A brand-new customer used to get a toast and an instant redirect: on
 * the reseller funnel they were thrown at a login form on a different
 * host with no explanation, and on the vendor funnel the welcome
 * disappeared in a second. This screen states the three things they
 * actually need — where their workspace lives, how long the trial runs,
 * and what to do first.
 */
import {
    Alert, Box, Button, Chip, Divider, Paper, Stack, Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import LanguageIcon from '@mui/icons-material/Language';

const fmtDate = (iso) => {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            day: 'numeric', month: 'short', year: 'numeric',
        });
    } catch { return null; }
};

export default function SignupSuccess({
    tenantName, workspaceUrl, trialEndsAt, addonsAttached = [],
    needsLogin, onContinue,
}) {
    const trial = fmtDate(trialEndsAt);
    const steps = needsLogin
        ? [
            ['Sign in to your workspace',
             'Use the email or phone and the password you just chose.'],
            ['Finish setting up',
             'Add your logo, working hours and services from Getting Started.'],
            ['Invite your team',
             'Create logins for your staff and providers.'],
        ]
        : [
            ['Finish setting up',
             'Getting Started walks you through your logo, working hours '
             + 'and services.'],
            ['Invite your team',
             'Create logins for your staff and providers.'],
            ['Choose how you pay',
             'Billing lets you pick a plan period whenever you are ready — '
             + 'nothing is charged during the trial.'],
        ];

    return (
        <Paper sx={{ p: { xs: 3, sm: 4 }, maxWidth: 640, mx: 'auto' }}>
            <Stack spacing={1} alignItems="center" textAlign="center">
                <CheckCircleOutlineIcon color="success" sx={{ fontSize: 52 }} />
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {tenantName} is ready
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Your workspace has been created
                    {trial ? ` and your free trial runs until ${trial}.` : '.'}
                </Typography>
            </Stack>

            {workspaceUrl && (
                <Alert severity="info" icon={<LanguageIcon />} sx={{ mt: 3 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Your workspace address
                    </Typography>
                    <Typography variant="body2"
                        sx={{ wordBreak: 'break-all' }}>
                        {workspaceUrl}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        Bookmark this — it is where you and your team sign in.
                    </Typography>
                </Alert>
            )}

            {addonsAttached.length > 0 && (
                <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                        Included for your trial:
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap"
                        useFlexGap sx={{ mt: 0.5 }}>
                        {addonsAttached.map((c) => (
                            <Chip key={c} size="small" label={c}
                                variant="outlined" />
                        ))}
                    </Stack>
                </Box>
            )}

            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                What to do next
            </Typography>
            <Stack spacing={1.75}>
                {steps.map(([title, detail], i) => (
                    <Stack key={title} direction="row" spacing={1.5}>
                        <Box sx={{
                            width: 26, height: 26, borderRadius: '50%',
                            bgcolor: 'primary.main', color: '#fff',
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'center', flex: '0 0 26px',
                            fontSize: 13, fontWeight: 700,
                        }}>
                            {i + 1}
                        </Box>
                        <Box>
                            <Typography variant="body2"
                                sx={{ fontWeight: 600 }}>
                                {title}
                            </Typography>
                            <Typography variant="caption"
                                color="text.secondary">
                                {detail}
                            </Typography>
                        </Box>
                    </Stack>
                ))}
            </Stack>

            <Button fullWidth variant="contained" size="large"
                sx={{ mt: 3 }} onClick={onContinue}>
                {needsLogin ? 'Go to sign in' : 'Start setting up'}
            </Button>
        </Paper>
    );
}
