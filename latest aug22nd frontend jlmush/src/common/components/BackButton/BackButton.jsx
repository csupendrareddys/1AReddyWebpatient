/**
 * BackButton — one "go back" control, meant to end up on every page.
 *
 * It prefers REAL history, so Back undoes the step the user actually took
 * rather than the step a page author guessed they took. A member-detail page
 * reached from the hub, from a search, or from a bookmark all deserve
 * different destinations, and only history knows which happened.
 *
 * But history alone isn't safe: on a deep link, a fresh tab, or a reload,
 * ``navigate(-1)`` walks OUT of the app — to whatever was in the tab before,
 * or nowhere at all. So ``to`` is the declared fallback for exactly that case,
 * and it is required: a Back button with no answer for "back to where?" is the
 * bug this component exists to stop shipping.
 *
 * ``onBack`` is for screens whose levels aren't history entries at all — the
 * Operations hub walks section -> role -> module in local state, so "up one
 * level" there is a state change, not a navigation.
 *
 * Usage:
 *     <BackButton to="/dashboard/admin/operations" />
 *     <BackButton to="/dashboard/admin" onBack={handleBack} />
 */
import { Button } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';

export default function BackButton({
    to, onBack, label = 'Back', size = 'small', sx,
}) {
    const navigate = useNavigate();

    const goBack = () => {
        if (onBack) {
            onBack();
            return;
        }
        // React Router stamps its own index on window.history.state. Anything
        // above 0 means there's an in-app entry behind us; 0 means this page IS
        // the first entry, so going back would leave the app.
        const idx = window.history.state?.idx;
        if (typeof idx === 'number' && idx > 0) navigate(-1);
        else navigate(to);
    };

    return (
        <Button
            size={size}
            onClick={goBack}
            startIcon={<ArrowBackIcon />}
            sx={{
                textTransform: 'none',
                color: 'text.secondary',
                flexShrink: 0,
                '&:hover': { bgcolor: 'action.hover' },
                ...sx,
            }}
        >
            {label}
        </Button>
    );
}
