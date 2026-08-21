import { useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    Avatar,
    Button,
    Chip,
    IconButton,
    Tooltip,
    Grid,
    Card,
    CardActionArea,
    Tabs,
    Tab,
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
import FlashOnIcon from '@mui/icons-material/FlashOn';
import PsychologyIcon from '@mui/icons-material/Psychology';
import VaccinesIcon from '@mui/icons-material/Vaccines';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/Notifications';
import CloseIcon from '@mui/icons-material/Close';
import StorefrontIcon from '@mui/icons-material/Storefront';
import { Navigate } from 'react-router-dom';

import OrderCard from '../../../components/OrderCard/OrderCard';
import PlatformCard from '../../../components/PlatformCard/PlatformCard';
import DoctorCard from '../../../components/DoctorCard/DoctorCard';
import RatingDialog from '../../../components/RatingDialog/RatingDialog';
import DocumentUploadDialog from '../../../components/DocumentUploadDialog/DocumentUploadDialog';
import BookingDialog from '../../../components/BookingDialog/BookingDialog';
import MyPurchases from '../../../Marketplace/pages/MyPurchases/MyPurchases';

import usePatientDashboard from '../../hooks/usePatientDashboard';
import { useGetPatientMembershipQuery } from '../../../api/patientEndpoints';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';

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
    { key: 'marketplace', label: 'Services', icon: <StorefrontIcon /> },
];

const PatientDashboard = () => {
    const {
        // Auth & theme
        user,
        isDarkMode,
        handleLogout,
        handleToggleTheme,
        navigate,

        // Navigation
        activeNav,
        mobileMenuOpen,
        handleNavChange,
        setMobileMenuOpen,

        // Doctor data
        doctors,
        doctorsLoading,
        doctorsPagination,

        // Symptoms
        symptoms,
        symptomCategories,

        // Platforms
        platforms,
        platformsLoading,

        // Orders
        orderTab,
        setOrderTab,
        upcomingOrders,
        upcomingLoading,
        previousOrders,
        previousLoading,
        handleRefreshOrders,

        // Search & Filters
        searchQuery,
        setSearchQuery,
        selectedSpecialization,
        setSelectedSpecialization,
        selectedGender,
        setSelectedGender,
        selectedLanguage,
        setSelectedLanguage,
        filterDrawerOpen,
        setFilterDrawerOpen,
        handleSearchDoctors,

        // Booking dialog
        bookingDialogOpen,
        selectedDoctorForBooking,
        handleBookDoctor,
        handleCloseBookingDialog,

        // Rating dialog
        ratingDialogOpen,
        ratingSubmitting,
        ratingError,
        handleRateClick,
        handleRatingSubmit,
        closeRatingDialog,

        // Document dialog
        documentDialogOpen,
        documentUploading,
        documentError,
        handleAddDocumentClick,
        handleDocumentSubmit,
        closeDocumentDialog,
    } = usePatientDashboard();

    // 'appointments' | 'services' — which side of the merged
    // "My Appointments / Services" section is showing.
    const [ordersView, setOrdersView] = useState('appointments');

    // The patient's marketplace/receiver membership plan (404 = none → no tag).
    const { data: membership } = useGetPatientMembershipQuery();
    const planName = membership?.plan?.name;

    // ─── Render helpers ─────────────────────────────

    const renderMainContent = () => {
        switch (activeNav) {
            case 'main':
                return renderMainView();
            case 'doctors':
                // Redirect to the proper dedicated Find a Doctor page
                navigate('/dashboard/patient/find-doctors');
                return renderMainView();
            case 'symptoms':
                return renderSymptomsView();
            case 'marketplace':
                return <Navigate to="/dashboard/patient/marketplace" replace />;
            default:
                return renderBookingView();
        }
    };

    const renderMainView = () => (
        <>
            {/* Membership plan tag — shows the patient's current plan. */}
            {planName && (
                <Box sx={{ mb: 2 }}>
                    <Chip
                        icon={<WorkspacePremiumIcon />}
                        label={`${planName} plan`}
                        color="primary"
                        variant="outlined"
                        sx={{ fontWeight: 600 }}
                    />
                </Box>
            )}

            {/* Quick Action Cards */}
            <Grid container spacing={2} sx={{ mb: 4 }}>
                <Grid item xs={6} md={3}>
                    <Card sx={{ bgcolor: 'primary.main', color: 'white', cursor: 'pointer' }}
                        onClick={() => navigate('/dashboard/patient/find-doctors')}>
                        <CardActionArea sx={{ p: 3, textAlign: 'center' }}>
                            <MedicalServicesIcon sx={{ fontSize: 48, mb: 1 }} />
                            <Typography variant="h6">Choose Doctor</Typography>
                        </CardActionArea>
                    </Card>
                </Grid>
                <Grid item xs={6} md={3}>
                    <Card sx={{ bgcolor: 'secondary.main', color: 'white', cursor: 'pointer' }}
                        onClick={() => navigate('/dashboard/patient?view=symptoms')}>
                        <CardActionArea sx={{ p: 3, textAlign: 'center' }}>
                            <SickIcon sx={{ fontSize: 48, mb: 1 }} />
                            <Typography variant="h6">Book by Symptoms</Typography>
                        </CardActionArea>
                    </Card>
                </Grid>
                <Grid item xs={6} md={3}>
                    <Card sx={{ bgcolor: 'warning.main', color: 'white', cursor: 'pointer' }}
                        onClick={() => navigate('/dashboard/patient?view=instant')}>
                        <CardActionArea sx={{ p: 3, textAlign: 'center' }}>
                            <FlashOnIcon sx={{ fontSize: 48, mb: 1 }} />
                            <Typography variant="h6">Instant Consultation</Typography>
                        </CardActionArea>
                    </Card>
                </Grid>
                <Grid item xs={6} md={3}>
                    <Card sx={{ bgcolor: 'success.main', color: 'white', cursor: 'pointer' }}
                        onClick={() => navigate('/dashboard/patient?view=clinic')}>
                        <CardActionArea sx={{ p: 3, textAlign: 'center' }}>
                            <LocalHospitalIcon sx={{ fontSize: 48, mb: 1 }} />
                            <Typography variant="h6">Clinical Visit</Typography>
                        </CardActionArea>
                    </Card>
                </Grid>
                <Grid item xs={6} md={3}>
                    <Card sx={{ bgcolor: 'info.main', color: 'white', cursor: 'pointer' }}
                        onClick={() => navigate('/dashboard/patient/marketplace')}>
                        <CardActionArea sx={{ p: 3, textAlign: 'center' }}>
                            <StorefrontIcon sx={{ fontSize: 48, mb: 1 }} />
                            <Typography variant="h6">Services</Typography>
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
                    My Appointments / Services
                </Typography>
                {ordersView === 'appointments' && (
                    <IconButton onClick={handleRefreshOrders}>
                        <RefreshIcon />
                    </IconButton>
                )}
            </Box>

            {/* Top-level toggle, mirroring the doctor's
                "My Appointments / Service List" view: consultations on one
                side, purchased marketplace services on the other. */}
            <ToggleButtonGroup
                value={ordersView}
                exclusive
                onChange={(e, next) => next && setOrdersView(next)}
                color="primary"
                size="small"
                sx={{ mb: 2 }}
            >
                <ToggleButton value="appointments">
                    <CalendarMonthIcon fontSize="small" sx={{ mr: 1 }} /> Appointments
                </ToggleButton>
                <ToggleButton value="services">
                    <StorefrontIcon fontSize="small" sx={{ mr: 1 }} /> Service List
                </ToggleButton>
            </ToggleButtonGroup>

            {ordersView === 'services' ? (
                <MyPurchases embedded />
            ) : (
                renderAppointmentsTabs()
            )}
        </>
    );

    const renderAppointmentsTabs = () => (
        <>
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
                            <OrderCard key={order.id} order={order} onRate={handleRateClick} onAddDocument={handleAddDocumentClick} />
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
                            <OrderCard key={order.id} order={order} onRate={handleRateClick} onAddDocument={handleAddDocumentClick} />
                        ))
                    )
                )}
            </Box>
        </>
    );

    // ─── Main render ────────────────────────────────

    return (
        <>
            {renderMainContent()}

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

            {/* Dialogs */}
            <RatingDialog open={ratingDialogOpen} onClose={closeRatingDialog} onSubmit={handleRatingSubmit} loading={ratingSubmitting} error={ratingError} />
            <DocumentUploadDialog open={documentDialogOpen} onClose={closeDocumentDialog} onSubmit={handleDocumentSubmit} loading={documentUploading} error={documentError} />
            <BookingDialog open={bookingDialogOpen} onClose={handleCloseBookingDialog} doctor={selectedDoctorForBooking} />

        </>
    );
};

export default PatientDashboard;
