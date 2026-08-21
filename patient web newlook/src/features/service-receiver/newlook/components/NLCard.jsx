/** Port of the mobile MVP's ``Card`` — the one surface every shelf row sits on. */
import { Box } from '@mui/material';
import { cardSx } from '../theme/tokens';

const NLCard = ({ sx, children, ...rest }) => (
    <Box sx={{ ...cardSx, ...sx }} {...rest}>
        {children}
    </Box>
);

export default NLCard;
