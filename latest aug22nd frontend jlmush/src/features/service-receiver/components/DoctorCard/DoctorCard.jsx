import {
    Card,
    CardContent,
    CardMedia,
    Typography,
    Box,
    Chip,
    Rating,
    Avatar,
    Stack,
    Button,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import LanguageIcon from '@mui/icons-material/Language';
import WorkIcon from '@mui/icons-material/Work';
import StarIcon from '@mui/icons-material/Star';
import EventIcon from '@mui/icons-material/Event';

import useMemberDiscount from '../../../../common/hooks/useMemberDiscount';
import {
    MemberDiscountChip, bestMemberDiscount, offeringMemberDiscount,
} from '../../../../common/components/PlanCard/MemberDiscountBadge';
import DiscountedPrice from '../../../../common/components/Price/DiscountedPrice';

/**
 * The cheapest marked-down consultation type this doctor offers, if any —
 * ``consultation_types`` comes back sorted cheapest first and only carries
 * ``original_price_min`` when the admin overlay discounts something.
 *
 * The card's headline ``consultation_fee`` is the doctor's flat fee, which
 * has no list price to slash: the overlay is keyed per consultation type ×
 * duration slot, so the only figure that can honestly be struck is the tier
 * price the booking flow will actually charge. Undiscounted doctors keep
 * quoting the flat fee exactly as before.
 */
const markedDownType = (consultationTypes = []) => (
    consultationTypes.find((ct) => ct?.original_price_min != null) || null
);

const DoctorCard = ({ doctor, onClick, onBook }) => {
    // The viewer's membership benefit, badged in the card's top-right corner.
    // The fee below stays the list fee — the reduction is itemised in the
    // booking summary, which is the screen that has to add up.
    //
    // Read off this doctor's own offerings rather than the plan's headline %:
    // that headline is a ceiling any single offering can be dialled below, so
    // a chip taking it at face value can promise more than the doctor beneath
    // it grants. ``planName`` is still the tier's, since it names the chip.
    const { planName } = useMemberDiscount();
    const {
        id,
        full_name,
        first_name,
        last_name,
        profile_image,
        highest_qualification,
        specializations = [],
        languages_known = [],
        experience_years,
        consultation_fee,
        consultation_types = [],
        rating,
        total_reviews,
        hospital_affiliations = [],
    } = doctor;

    const displayName = full_name || `${first_name || ''} ${last_name || ''}`.trim();
    const discounted = markedDownType(consultation_types);
    // Best across the types this doctor offers, so the chip is an "up to"
    // unless the card is down to a single offering that says otherwise.
    const memberPct = bestMemberDiscount(consultation_types);
    const memberExact = consultation_types.length === 1
        && offeringMemberDiscount(consultation_types[0]).exact;

    return (
        <Card
            sx={{
                position: 'relative',
                overflow: 'visible',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                transition: 'all 0.3s ease',
                '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 6,
                },
            }}
        >
            <MemberDiscountChip
                pct={memberPct}
                exact={memberExact}
                planName={planName}
                sx={{ position: 'absolute', top: -10, right: 10, zIndex: 2 }}
            />
            <Box sx={{ display: 'flex', p: 2, cursor: onClick ? 'pointer' : 'default' }} onClick={() => onClick?.(id)}>
                {profile_image ? (
                    <CardMedia
                        component="img"
                        sx={{ width: 80, height: 80, borderRadius: 2 }}
                        image={profile_image}
                        alt={displayName}
                    />
                ) : (
                    <Avatar
                        sx={{
                            width: 80,
                            height: 80,
                            bgcolor: 'primary.main',
                            fontSize: 32,
                        }}
                    >
                        <PersonIcon sx={{ fontSize: 40 }} />
                    </Avatar>
                )}
                <Box sx={{ ml: 2, flex: 1 }}>
                    <Typography variant="h6" component="div" fontWeight="bold">
                        Dr. {displayName}
                    </Typography>
                    {highest_qualification && (
                        <Typography variant="body2" color="text.secondary">
                            {highest_qualification}
                        </Typography>
                    )}
                    {rating !== null && rating !== undefined && (
                        <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                            <Rating
                                value={rating}
                                readOnly
                                size="small"
                                precision={0.1}
                                emptyIcon={<StarIcon fontSize="inherit" />}
                            />
                            <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                ({total_reviews || 0} reviews)
                            </Typography>
                        </Box>
                    )}
                </Box>
            </Box>

            <CardContent sx={{ pt: 0, flexGrow: 1 }}>
                {/* Specializations */}
                {specializations.length > 0 && (
                    <Box sx={{ mb: 1.5 }}>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {specializations.slice(0, 3).map((spec, index) => (
                                <Chip
                                    key={index}
                                    label={spec}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    sx={{ fontSize: '0.75rem' }}
                                />
                            ))}
                            {specializations.length > 3 && (
                                <Chip
                                    label={`+${specializations.length - 3}`}
                                    size="small"
                                    sx={{ fontSize: '0.75rem' }}
                                />
                            )}
                        </Stack>
                    </Box>
                )}

                {/* Experience */}
                {experience_years && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <WorkIcon fontSize="small" color="action" sx={{ mr: 1 }} />
                        <Typography variant="body2" color="text.secondary">
                            {experience_years} years experience
                        </Typography>
                    </Box>
                )}

                {/* Languages */}
                {languages_known.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <LanguageIcon fontSize="small" color="action" sx={{ mr: 1 }} />
                        <Typography variant="body2" color="text.secondary">
                            {languages_known.join(', ')}
                        </Typography>
                    </Box>
                )}

                {/* Hospital */}
                {hospital_affiliations.length > 0 && hospital_affiliations[0].hospital_name && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        📍 {hospital_affiliations[0].hospital_name}
                        {hospital_affiliations[0].city && `, ${hospital_affiliations[0].city}`}
                    </Typography>
                )}
            </CardContent>

            {/* Consultation Fee & Book Button */}
            <Box
                sx={{
                    p: 2,
                    pt: 0,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <Box>
                    {discounted ? (
                        <>
                            <Typography variant="caption" color="text.secondary">
                                Consultation Fee (from)
                            </Typography>
                            {/* The admin's markdown on this doctor's cheapest
                                offering. Distinct from the membership chip in
                                the corner above — that one is the viewer's own
                                tier and comes off at checkout, this one is
                                already in the number shown. */}
                            <DiscountedPrice
                                price={discounted.price_min}
                                original={discounted.original_price_min}
                                discountPct={discounted.discount_pct}
                                variant="h6"
                                originalVariant="body2"
                            />
                        </>
                    ) : consultation_fee && (
                        <>
                            <Typography variant="caption" color="text.secondary">
                                Consultation Fee
                            </Typography>
                            <Typography variant="h6" color="primary" fontWeight="bold">
                                ₹{consultation_fee}
                            </Typography>
                        </>
                    )}
                </Box>
                {onBook && (
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={<EventIcon />}
                        onClick={(e) => {
                            e.stopPropagation();
                            onBook(doctor);
                        }}
                        sx={{ ml: 1 }}
                    >
                        Book
                    </Button>
                )}
            </Box>
        </Card>
    );
};

export default DoctorCard;
