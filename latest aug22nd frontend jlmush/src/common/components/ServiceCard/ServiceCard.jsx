import { Box, Card, Typography } from '@mui/material';
import { MedicalServicesOutlined } from '@mui/icons-material';

import useMemberDiscount from '../../hooks/useMemberDiscount';
import { MemberDiscountChip } from '../PlanCard/MemberDiscountBadge';

const ServiceCard = ({ service, onClick }) => {
  const Icon = service.icon || MedicalServicesOutlined;
  // Renders on the public landing page too, where nobody is signed in — the
  // hook returns 0 without a request there, so the chip self-hides.
  const { discountPct, planName } = useMemberDiscount();

  return (
    <Card
      onClick={onClick}
      variant="outlined"
      sx={{
        position: 'relative',
        overflow: 'visible',
        p: { xs: 2.5, sm: 3, md: 4 },
        borderRadius: 4,
        cursor: 'pointer',
        border: '1px solid',
        borderColor: 'grey.100',
        boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.08)',
          '& .service-icon-box': {
            bgcolor: 'primary.main',
            '& .MuiSvgIcon-root': { color: '#fff' },
          },
          '& .service-cta': {
            bgcolor: 'primary.main',
            color: '#fff',
          },
        },
      }}
    >
      {/* The one surface where the tier's ceiling really is the only figure
          available: these are static landing-page categories, not priced
          offerings, so there is no per-offering rate to resolve and "up to"
          is the honest word. */}
      <MemberDiscountChip
        pct={discountPct}
        exact={false}
        planName={planName}
        sx={{ position: 'absolute', top: -10, right: 12, zIndex: 2 }}
      />

      {/* Icon */}
      <Box
        className="service-icon-box"
        sx={{
          width: { xs: 48, md: 56 },
          height: { xs: 48, md: 56 },
          borderRadius: 3,
          bgcolor: 'primary.50',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: { xs: 2, md: 3 },
          transition: 'all 0.3s',
        }}
      >
        <Icon sx={{ fontSize: { xs: 24, md: 28 }, color: 'primary.main', transition: 'color 0.3s' }} />
      </Box>

      {/* Title */}
      <Typography
        variant="h6"
        fontWeight={700}
        color="text.primary"
        sx={{
          mb: 1.5,
          letterSpacing: '-0.02em',
          fontSize: { xs: '1rem', md: '1.125rem' },
          wordBreak: 'break-word',
        }}
      >
        {service.title}
      </Typography>

      {/* Description */}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          mb: { xs: 2, md: 3 },
          lineHeight: 1.6,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {service.desc}
      </Typography>

      {/* Price & CTA */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          // Price and CTA share a narrow card on mobile — let them wrap
          // onto two lines rather than squashing the "Get Started" pill.
          flexWrap: 'wrap',
          gap: 1.5,
          mt: 'auto',
          pt: { xs: 2, md: 3 },
          borderTop: '1px solid',
          borderColor: 'grey.50',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Typography
            variant="caption"
            fontWeight={700}
            color="text.disabled"
            sx={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.625rem' }}
          >
            Starts From
          </Typography>
          <Typography variant="subtitle1" fontWeight={700} color="text.primary" sx={{ fontSize: '1.125rem' }}>
            {service.price}
          </Typography>
        </Box>
        <Box
          className="service-cta"
          sx={{
            bgcolor: 'primary.50',
            color: 'primary.main',
            px: 2.5,
            py: 1,
            borderRadius: 5,
            fontSize: '0.75rem',
            fontWeight: 700,
            transition: 'all 0.3s',
          }}
        >
          Get Started
        </Box>
      </Box>
    </Card>
  );
};

export default ServiceCard;