/**
 * ActionCardGrid — Permission-filtered grid of dashboard action cards
 * Styled with premium look matching JLMUSH dashboard design
 */
import { Typography, Grid, Box } from '@mui/material';

const ActionCardGrid = ({ actionCards }) => {
    const visibleCards = actionCards.filter((card) => card.visible);

    return (
        <>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2, color: '#2D3436' }}>
                Quick Actions
            </Typography>
            <Grid container spacing={2.5}>
                {visibleCards.map((card, index) => {
                    const IconComponent = card.icon;
                    return (
                        <Grid item xs={12} sm={6} md={3} key={index}>
                            <Box
                                onClick={card.onClick}
                                className="admin-page-card"
                                sx={{
                                    textAlign: 'center',
                                    py: 3,
                                    px: 2,
                                    cursor: 'pointer',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    '&:hover': {
                                        transform: 'translateY(-4px)',
                                        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
                                    },
                                }}
                            >
                                <Box
                                    sx={{
                                        width: 52,
                                        height: 52,
                                        borderRadius: '14px',
                                        bgcolor: `${card.iconColor}15`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        mx: 'auto',
                                        mb: 1.5,
                                    }}
                                >
                                    <IconComponent sx={{ fontSize: 28, color: card.iconColor }} />
                                </Box>
                                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.3 }}>
                                    {card.title}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                                    {card.description}
                                </Typography>
                            </Box>
                        </Grid>
                    );
                })}
            </Grid>
        </>
    );
};

export default ActionCardGrid;
