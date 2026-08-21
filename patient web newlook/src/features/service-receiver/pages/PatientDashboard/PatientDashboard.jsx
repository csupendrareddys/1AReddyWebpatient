import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Container,
    Typography,
    Paper,
    Avatar,
    Button,
    Chip,
    IconButton,
    Tooltip,
    Grid,
    Card,
    CardContent,
    CardActionArea,
    Tabs,
    Tab,
    CircularProgress,
    Alert,
    Skeleton,
    Divider,
    TextField,
    InputAdornment,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ToggleButton,
    ToggleButtonGroup,
    Drawer,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    AppBar,
    Toolbar,
    Badge,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import LogoutIcon from '@mui/icons-material/Logout';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import HistoryIcon from '@mui/icons-material/History';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import HomeIcon from '@mui/icons-material/Home';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import SickIcon from '@mui/icons-material/Sick';
import VideocamIcon from '@mui/icons-material/Videocam';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import PsychologyIcon from '@mui/icons-material/Psychology';
import VaccinesIcon from '@mui/icons-material/Vaccines';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/Notifications';
import CloseIcon from '@mui/icons-material/Close';

import { logoutUser } from '../../../auth/redux/authSlice';
import { toggleTheme } from '../../../auth/redux/themeSlice';
import usePatientData from '../../hooks/usePatientData';

import OrderCard from '../../components/OrderCard/OrderCard';
import PlatformCard from '../../components/PlatformCard/PlatformCard';
import DoctorCard from '../../components/DoctorCard/DoctorCard';
import RatingDialog from '../../components/RatingDialog/RatingDialog';
import DocumentUploadDialog from '../../components/DocumentUploadDialog/DocumentUploadDialog';
import BookingDialog from '../../components/BookingDialog/BookingDialog';

import {
    useCreatePaymentOrderMutation,
    useVerifyPaymentMutation
} from '../../api/patientEndpoints';
import { loadRazorpayScript } from '../../../../utils/loadRazorpayScript';

import './PatientDashboard.css';

// Navigation tabs
const NAV_TABS = [
    { key: 'main', label: 'Main', icon: <HomeIcon /> },
    { key: 'doctors', label: 'Choose Doctors', icon: <MedicalServicesIcon /> },
    { key: 'symptoms', label: 'Based on Symptoms', icon: <SickIcon /> },
    { key: 'instant', label: 'IC', icon: <FlashOnIcon /> },
    { key: 'clinic', label: 'Clinical Visit', icon: <LocalHospitalIcon /> },
    { key: 'counselling', label: 'Counselling', icon: <PsychologyIcon /> },
    { key: 'home_visit', label: 'Home Visit', icon: <HomeIcon /> },
    { key: 'vaccination', label: 'Vaccination', icon: <VaccinesIcon /> },
];

const PatientDashboard = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const { isDarkMode } = useSelector((state) => state.theme);

    // Patient data hook
    const {
        platforms,
        platformsLoading,
        doctors,
        doctorsLoading,
        doctorsPagination,
        symptoms,
        symptomCategories,
        upcomingOrders,
        upcomingLoading,
        upcomingError,
        previousOrders,
        previousLoading,
        previousError,
        ratingSubmitting,
        ratingError,
        documentUploading,
        documentError,
        fetchDashboardData,
        loadDoctors,
        loadSymptoms,
        loadUpcomingOrders,
        loadPreviousOrders,
        rateOrder,
        uploadDocument,
    } = usePatientData();

    // Local state
    const [activeNav, setActiveNav] = useState('main');
    const [orderTab, setOrderTab] = useState(0);
    const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
    const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
    const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState(null);
    const [selectedDoctorForBooking, setSelectedDoctorForBooking] = useState(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

    // Payment Mutations
    const [createPaymentOrder] = useCreatePaymentOrderMutation();
    const [verifyPayment] = useVerifyPaymentMutation();
    const [paymentLoading, setPaymentLoading] = useState(false);

    // Fetch data on mount
    useEffect(() => {
        fetchDashboardData();
        loadDoctors();
        loadSymptoms();
    }, [fetchDashboardData, loadDoctors, loadSymptoms]);

    const handleLogout = async () => {
        try {
            await dispatch(logoutUser()).unwrap();
        } catch (error) {
            console.log('Logout API failed, but clearing local state');
        }
        navigate('/auth/service-receiver/login');
    };

    const handleNavChange = (navKey) => {
        setActiveNav(navKey);
        setMobileMenuOpen(false);

        // Map nav to platform for booking
        const platformMap = {
            'instant': 'instant_consultation',
            'clinic': 'clinical_consultation',
            'counselling': 'counseling',
            'home_visit': 'patient_home_visit',
            'vaccination': 'vaccination',
        };

        if (platformMap[navKey]) {
            console.log('Selected platform:', platformMap[navKey]);
        }
    };

    const handleSearchDoctors = () => {
        loadDoctors({
            name: searchQuery,
            specialization: selectedSpecialization,
        });
    };

    const handleBookDoctor = (doctor) => {
        setSelectedDoctorForBooking(doctor);
        setBookingDialogOpen(true);
    };

    const handleCloseBookingDialog = () => {
        setBookingDialogOpen(false);
        setSelectedDoctorForBooking(null);
    };

    const handleRateClick = (orderId) => {
        setSelectedOrderId(orderId);
        setRatingDialogOpen(true);
    };

    const handleAddDocumentClick = (orderId) => {
        setSelectedOrderId(orderId);
        setDocumentDialogOpen(true);
    };

    const handleRatingSubmit = async (rating, review, isAnonymous) => {
        try {
            await rateOrder(selectedOrderId, rating, review, isAnonymous);
            setRatingDialogOpen(false);
            setSelectedOrderId(null);
        } catch (error) {
            // Error handled in Redux
        }
    };

    const handleDocumentSubmit = async (documentData) => {
        try {
            await uploadDocument(selectedOrderId, documentData);
            setDocumentDialogOpen(false);
            setSelectedOrderId(null);
        } catch (error) {
            // Error handled in Redux
        }
    };

    const handlePay = async (appointment) => {
        try {
            setPaymentLoading(true);
            
            // 1. Load Razorpay Script
            const res = await loadRazorpayScript();
            if (!res) {
                alert('Razorpay SDK failed to load. Are you online?');
                return;
            }

            // 2. Create Order in Backend
            const orderRes = await createPaymentOrder({ 
                appointment_id: appointment.id,
                amount: appointment.consultation_fee
            }).unwrap();

            if (!orderRes.success) {
                alert(orderRes.message || 'Failed to create payment order');
                return;
            }

            const { rz_order_id, amount_paise, currency } = orderRes.data;

            // 3. Open Razorpay Checkout
            const options = {
                key: import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_your_key_id', // Fallback or env
                amount: amount_paise,
                currency: currency,
                name: 'Healthcare App',
                description: `Payment for Appointment #${appointment.id.substring(0,8)}`,
                order_id: rz_order_id,
                handler: async (response) => {
                    // 4. Verify Payment in Backend
                    try {
                        const verifyRes = await verifyPayment({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature
                        }).unwrap();

                        if (verifyRes.success) {
                            alert('Payment Successful!');
                            loadUpcomingOrders(); // Refresh to see updated status
                        } else {
                            alert('Payment verification failed: ' + verifyRes.message);
                        }
                    } catch (err) {
                        alert('Payment verification error occurred');
                    }
                },
                // Prefer the backend-resolved profile (decrypted phone) so the
                // popup never re-asks; fall back to the in-memory user.
                prefill: {
                    name: orderRes.data?.prefill?.name || user?.full_name,
                    email: orderRes.data?.prefill?.email || user?.email,
                    contact: orderRes.data?.prefill?.contact || user?.phone,
                },
                theme: {
                    color: '#3f51b5'
                }
            };

            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', (response) => {
                alert('Payment Failed: ' + response.error.description);
            });
            rzp.open();

        } catch (error) {
            console.error('Payment initiation error:', error);
            alert('Could not initiate payment');
        } finally {
            setPaymentLoading(false);
        }
    };

    const renderMainContent = () => {
        switch (activeNav) {
            case 'main':
                return renderMainView();
            case 'doctors':
                return renderDoctorsView();
            case 'symptoms':
                return renderSymptomsView();
            default:
                return renderBookingView();
        }
    };

    const renderMainView = () => (
        <>
            {/* Quick Action Cards */}
            <Grid container spacing={2} sx={{ mb: 4 }}>
                <Grid item xs={6} md={3}>
                    <Card sx={{ bgcolor: 'primary.main', color: 'white', cursor: 'pointer' }}
                        onClick={() => setActiveNav('doctors')}>
                        <CardActionArea sx={{ p: 3, textAlign: 'center' }}>
                            <MedicalServicesIcon sx={{ fontSize: 48, mb: 1 }} />
                            <Typography variant="h6">Choose Doctor</Typography>
                        </CardActionArea>
                    </Card>
                </Grid>
                <Grid item xs={6} md={3}>
                    <Card sx={{ bgcolor: 'secondary.main', color: 'white', cursor: 'pointer' }}
                        onClick={() => setActiveNav('symptoms')}>
                        <CardActionArea sx={{ p: 3, textAlign: 'center' }}>
                            <SickIcon sx={{ fontSize: 48, mb: 1 }} />
                            <Typography variant="h6">Book by Symptoms</Typography>
                        </CardActionArea>
                    </Card>
                </Grid>
                <Grid item xs={6} md={3}>
                    <Card sx={{ bgcolor: 'warning.main', color: 'white', cursor: 'pointer' }}
                        onClick={() => handleNavChange('instant')}>
                        <CardActionArea sx={{ p: 3, textAlign: 'center' }}>
                            <FlashOnIcon sx={{ fontSize: 48, mb: 1 }} />
                            <Typography variant="h6">Instant Consultation</Typography>
                        </CardActionArea>
                    </Card>
                </Grid>
                <Grid item xs={6} md={3}>
                    <Card sx={{ bgcolor: 'success.main', color: 'white', cursor: 'pointer' }}
                        onClick={() => handleNavChange('clinic')}>
                        <CardActionArea sx={{ p: 3, textAlign: 'center' }}>
                            <LocalHospitalIcon sx={{ fontSize: 48, mb: 1 }} />
                            <Typography variant="h6">Clinical Visit</Typography>
                        </CardActionArea>
                    </Card>
                </Grid>
            </Grid>

            {/* More Platforms */}
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 'medium' }}>
                More Services
            </Typography>
            <Grid container spacing={2} sx={{ mb: 4 }}>
                {platformsLoading ? (
                    [1, 2, 3].map((i) => (
                        <Grid item xs={6} sm={4} md={3} key={i}>
                            <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
                        </Grid>
                    ))
                ) : (
                    platforms.filter(p => !['online_consultation', 'instant_consultation'].includes(p.key)).map((platform) => (
                        <Grid item xs={6} sm={4} md={3} key={platform.key}>
                            <PlatformCard platform={platform} onClick={() => handleNavChange(platform.key)} />
                        </Grid>
                    ))
                )}
            </Grid>

            {/* Appointments Section */}
            <Divider sx={{ my: 3 }} />
            {renderOrdersSection()}
        </>
    );

    const renderDoctorsView = () => (
        <>
            {/* Search and Filter Bar */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={6}>
                        <TextField
                            fullWidth
                            placeholder="Search Doctor by Name or ID"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSearchDoctors()}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon />
                                    </InputAdornment>
                                ),
                            }}
                        />
                    </Grid>
                    <Grid item xs={6} md={2}>
                        <Button
                            fullWidth
                            variant="contained"
                            startIcon={<SearchIcon />}
                            onClick={handleSearchDoctors}
                        >
                            Search
                        </Button>
                    </Grid>
                    <Grid item xs={6} md={2}>
                        <Button
                            fullWidth
                            variant="outlined"
                            startIcon={<FilterListIcon />}
                            onClick={() => setFilterDrawerOpen(true)}
                        >
                            Filter
                        </Button>
                    </Grid>
                </Grid>
            </Paper>

            {/* Filter Chips */}
            <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label="Filter" icon={<FilterListIcon />} variant="outlined" onClick={() => setFilterDrawerOpen(true)} />
                <Chip label="Search Doctor" color="primary" variant="outlined" />
                <Chip label="Select Patient ID" variant="outlined" />
                <Chip label="Recommended Doctors" variant="outlined" />
            </Box>

            {/* Doctors Grid */}
            <Typography variant="h6" gutterBottom>
                {doctorsPagination?.total || 0} Doctors Found
            </Typography>
            <Grid container spacing={2}>
                {doctorsLoading ? (
                    [1, 2, 3, 4].map((i) => (
                        <Grid item xs={12} sm={6} md={4} key={i}>
                            <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
                        </Grid>
                    ))
                ) : doctors.length === 0 ? (
                    <Grid item xs={12}>
                        <Paper sx={{ p: 4, textAlign: 'center' }}>
                            <Typography color="text.secondary">No doctors found. Try adjusting your filters.</Typography>
                        </Paper>
                    </Grid>
                ) : (
                    doctors.map((doctor) => (
                        <Grid item xs={12} sm={6} md={4} key={doctor.id}>
                            <DoctorCard 
                                doctor={doctor} 
                                onClick={(id) => console.log('View doctor:', id)} 
                                onBook={handleBookDoctor}
                            />
                        </Grid>
                    ))
                )}
            </Grid>
        </>
    );

    const renderSymptomsView = () => (
        <>
            <Typography variant="h6" gutterBottom>Select Your Symptoms</Typography>
            <Paper sx={{ p: 3 }}>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                    Select the symptoms you are experiencing to find the right doctor.
                </Typography>

                {symptomCategories.map((category) => (
                    <Box key={category} sx={{ mb: 3 }}>
                        <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                            {category}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {symptoms.filter(s => s.category === category).map((symptom) => (
                                <Chip
                                    key={symptom.id}
                                    label={symptom.name}
                                    clickable
                                    variant="outlined"
                                    color="primary"
                                />
                            ))}
                        </Box>
                    </Box>
                ))}

                {symptoms.length === 0 && (
                    <Typography color="text.secondary">No symptoms available. Please check back later.</Typography>
                )}
            </Paper>
        </>
    );

    const renderBookingView = () => (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h5" gutterBottom>
                {NAV_TABS.find(t => t.key === activeNav)?.label || 'Book Consultation'}
            </Typography>
            <Typography color="text.secondary">
                This booking flow is under development. Check back soon!
            </Typography>
        </Paper>
    );

    const renderOrdersSection = () => (
        <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 'medium' }}>
                    My Appointments
                </Typography>
                <IconButton onClick={() => orderTab === 0 ? loadUpcomingOrders() : loadPreviousOrders()}>
                    <RefreshIcon />
                </IconButton>
            </Box>

            <Tabs value={orderTab} onChange={(e, v) => setOrderTab(v)} sx={{ mb: 2 }}>
                <Tab icon={<CalendarMonthIcon />} iconPosition="start" label={`Upcoming (${upcomingOrders.length})`} />
                <Tab icon={<HistoryIcon />} iconPosition="start" label={`Previous (${previousOrders.length})`} />
            </Tabs>

            <Box>
                {orderTab === 0 ? (
                    upcomingLoading ? (
                        <Skeleton variant="rectangular" height={150} />
                    ) : upcomingOrders.length === 0 ? (
                        <Paper sx={{ p: 3, textAlign: 'center' }}>
                            <Typography color="text.secondary">No upcoming appointments</Typography>
                        </Paper>
                    ) : (
                        upcomingOrders.map((order) => (
                            <OrderCard key={order.id} order={order} onRate={handleRateClick} onAddDocument={handleAddDocumentClick} onPay={() => handlePay(order)} />
                        ))
                    )
                ) : (
                    previousLoading ? (
                        <Skeleton variant="rectangular" height={150} />
                    ) : previousOrders.length === 0 ? (
                        <Paper sx={{ p: 3, textAlign: 'center' }}>
                            <Typography color="text.secondary">No previous appointments</Typography>
                        </Paper>
                    ) : (
                        previousOrders.map((order) => (
                            <OrderCard key={order.id} order={order} onRate={handleRateClick} onAddDocument={handleAddDocumentClick} onPay={() => handlePay(order)} />
                        ))
                    )
                )}
            </Box>
        </>
    );

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
            {/* Top App Bar */}
            <AppBar position="sticky" color="default" elevation={1}>
                <Toolbar>
                    <IconButton edge="start" sx={{ display: { md: 'none' } }} onClick={() => setMobileMenuOpen(true)}>
                        <MenuIcon />
                    </IconButton>
                    <LocalHospitalIcon color="primary" sx={{ mr: 1 }} />
                    <Typography variant="h6" color="primary" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
                        Healthcare
                    </Typography>
                    <Tooltip title="Notifications">
                        <IconButton><Badge badgeContent={2} color="error"><NotificationsIcon /></Badge></IconButton>
                    </Tooltip>
                    <Tooltip title={isDarkMode ? 'Light Mode' : 'Dark Mode'}>
                        <IconButton onClick={() => dispatch(toggleTheme())}>
                            {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
                        </IconButton>
                    </Tooltip>
                    <Chip
                        avatar={<Avatar><PersonIcon /></Avatar>}
                        label={user?.first_name || 'Patient'}
                        variant="outlined"
                        sx={{ mx: 1 }}
                        onClick={() => navigate('/dashboard/patient/profile')}
                    />
                    <Tooltip title="Logout">
                        <IconButton onClick={handleLogout} color="error"><LogoutIcon /></IconButton>
                    </Tooltip>
                </Toolbar>
            </AppBar>

            {/* Navigation Tabs - Desktop */}
            <Paper sx={{ display: { xs: 'none', md: 'block' }, borderRadius: 0 }}>
                <Container maxWidth="lg">
                    <Box sx={{ display: 'flex', gap: 1, py: 1, overflowX: 'auto' }}>
                        {NAV_TABS.map((tab) => (
                            <Chip
                                key={tab.key}
                                label={tab.label}
                                icon={tab.icon}
                                onClick={() => handleNavChange(tab.key)}
                                color={activeNav === tab.key ? 'primary' : 'default'}
                                variant={activeNav === tab.key ? 'filled' : 'outlined'}
                                sx={{ cursor: 'pointer' }}
                            />
                        ))}
                    </Box>
                </Container>
            </Paper>

            {/* Mobile Drawer */}
            <Drawer anchor="left" open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)}>
                <Box sx={{ width: 280, p: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="h6">Menu</Typography>
                        <IconButton onClick={() => setMobileMenuOpen(false)}><CloseIcon /></IconButton>
                    </Box>
                    <List>
                        {NAV_TABS.map((tab) => (
                            <ListItem key={tab.key} disablePadding>
                                <ListItemButton selected={activeNav === tab.key} onClick={() => handleNavChange(tab.key)}>
                                    <ListItemIcon>{tab.icon}</ListItemIcon>
                                    <ListItemText primary={tab.label} />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                </Box>
            </Drawer>

            {/* Filter Drawer */}
            <Drawer anchor="right" open={filterDrawerOpen} onClose={() => setFilterDrawerOpen(false)}>
                <Box sx={{ width: 320, p: 3 }}>
                    <Typography variant="h6" gutterBottom>Filters</Typography>
                    <FormControl fullWidth sx={{ mb: 2 }}>
                        <InputLabel>Specialization</InputLabel>
                        <Select value={selectedSpecialization} onChange={(e) => setSelectedSpecialization(e.target.value)} label="Specialization">
                            <MenuItem value="">All</MenuItem>
                            <MenuItem value="General">General Physician</MenuItem>
                            <MenuItem value="Cardiology">Cardiology</MenuItem>
                            <MenuItem value="Dermatology">Dermatology</MenuItem>
                            <MenuItem value="Pediatrics">Pediatrics</MenuItem>
                        </Select>
                    </FormControl>
                    <Typography variant="subtitle2" gutterBottom>Gender</Typography>
                    <ToggleButtonGroup value={selectedGender} exclusive onChange={(e, v) => setSelectedGender(v)} sx={{ mb: 2 }}>
                        <ToggleButton value="male">Male</ToggleButton>
                        <ToggleButton value="female">Female</ToggleButton>
                        <ToggleButton value="">Any</ToggleButton>
                    </ToggleButtonGroup>
                    <FormControl fullWidth sx={{ mb: 2 }}>
                        <InputLabel>Language</InputLabel>
                        <Select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)} label="Language">
                            <MenuItem value="">All</MenuItem>
                            <MenuItem value="English">English</MenuItem>
                            <MenuItem value="Hindi">Hindi</MenuItem>
                            <MenuItem value="Telugu">Telugu</MenuItem>
                        </Select>
                    </FormControl>
                    <Button fullWidth variant="contained" onClick={() => { handleSearchDoctors(); setFilterDrawerOpen(false); }}>
                        Apply Filters
                    </Button>
                </Box>
            </Drawer>

            {/* Main Content */}
            <Container maxWidth="lg" sx={{ py: 3 }}>
                {renderMainContent()}
            </Container>

            {/* Dialogs */}
            <RatingDialog open={ratingDialogOpen} onClose={() => setRatingDialogOpen(false)} onSubmit={handleRatingSubmit} loading={ratingSubmitting} error={ratingError} />
            <DocumentUploadDialog open={documentDialogOpen} onClose={() => setDocumentDialogOpen(false)} onSubmit={handleDocumentSubmit} loading={documentUploading} error={documentError} />
            <BookingDialog open={bookingDialogOpen} onClose={handleCloseBookingDialog} doctor={selectedDoctorForBooking} />
        </Box>
    );
};

export default PatientDashboard;
