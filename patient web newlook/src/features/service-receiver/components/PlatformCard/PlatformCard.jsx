import { Card, CardContent, CardActionArea, Typography, Box, Avatar } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import HomeIcon from '@mui/icons-material/Home';
import PsychologyIcon from '@mui/icons-material/Psychology';
import VaccinesIcon from '@mui/icons-material/Vaccines';

const platformIcons = {
    online_consultation: VideocamIcon,
    instant_consultation: FlashOnIcon,
    clinical_consultation: LocalHospitalIcon,
    patient_home_visit: HomeIcon,
    counseling: PsychologyIcon,
    vaccination: VaccinesIcon,
};

const platformColors = {
    online_consultation: '#2196f3',
    instant_consultation: '#ff9800',
    clinical_consultation: '#4caf50',
    patient_home_visit: '#9c27b0',
    counseling: '#00bcd4',
    vaccination: '#f44336',
};

const PlatformCard = ({ platform, onClick, selected = false }) => {
    const { key, name, description } = platform;
    const Icon = platformIcons[key] || LocalHospitalIcon;
    const color = platformColors[key] || '#757575';

    return (
        <Card
            sx={{
                height: '100%',
                border: selected ? `2px solid ${color}` : '1px solid',
                borderColor: selected ? color : 'divider',
                transition: 'all 0.3s ease',
                '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                    borderColor: color,
                },
            }}
        >
            <CardActionArea
                onClick={() => onClick?.(platform)}
                sx={{ height: '100%', p: 2 }}
            >
                <CardContent sx={{ textAlign: 'center', p: 0 }}>
                    <Avatar
                        sx={{
                            bgcolor: `${color}15`,
                            width: 64,
                            height: 64,
                            mx: 'auto',
                            mb: 2,
                        }}
                    >
                        <Icon sx={{ fontSize: 32, color: color }} />
                    </Avatar>
                    <Typography variant="h6" component="div" gutterBottom fontWeight="medium">
                        {name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {description}
                    </Typography>
                </CardContent>
            </CardActionArea>
        </Card>
    );
};

export default PlatformCard;
