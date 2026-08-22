import React, { useEffect } from 'react';
import { Box } from '@mui/material';
import usePricingConfig from '../hooks/usePricingConfig';
import PricingSlots from '../components/PricingSlots';

const PricingSection = React.memo(({ previewMode = false, registerSave }) => {
    const {
        slotPricing,
        availabilityApprovalStatus,
        availabilityRejectionReason,
        granularStatus,
        handleSlotPricingChange,
        handleSavePricing,
    } = usePricingConfig(previewMode);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSavePricing, 'Save & Submit for Approval', false);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSavePricing]);

    return (
        <Box>
            <div className="section-title-bar">Consultation Pricing</div>
            <PricingSlots
                slots={slotPricing}
                onChange={handleSlotPricingChange}
                approvalStatus={availabilityApprovalStatus}
                rejectionReason={availabilityRejectionReason}
                granularStatus={granularStatus}
            />
        </Box>
    );
});

PricingSection.displayName = 'PricingSection';
export default PricingSection;
