/**
 * Live plan-card preview inside the plan dialog — renders the REAL
 * public PlanCard from the form's current values, with the same
 * billing toggle buyers get. What the operator sees here is exactly
 * what the pricing page will render, because it IS that component.
 */
import { useMemo, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';

import PlanCard from '../../../../common/components/PlanCard/PlanCard';
import BillingPeriodToggle from
    '../../../../common/components/PlanCard/BillingPeriodToggle';
import { BILLING_PERIODS } from
    '../../../../common/components/PlanCard/planPricing';

export default function PlanCardPreview({ planForm, addons = [] }) {
    // The card's pricing helpers read a NESTED ``plan.pricing`` dict
    // (the server shape); the form holds the same keys flat, so build
    // the nested dict from them.
    const plan = useMemo(() => {
        const pricing = {};
        BILLING_PERIODS.forEach((p) => {
            ['price_inr_', 'og_price_inr_'].forEach((pre) => {
                const v = planForm[`${pre}${p.key}`];
                if (v !== null && v !== undefined && v !== '') {
                    pricing[`${pre}${p.key}`] = v;
                }
            });
        });
        return {
            ...planForm,
            pricing,
            code: planForm.code || 'preview',
            name: planForm.name || 'Untitled plan',
        };
    }, [planForm]);

    const offered = useMemo(() => BILLING_PERIODS.filter((p) => {
        const v = planForm[`price_inr_${p.key}`];
        return v !== null && v !== undefined && v !== '';
    }), [planForm]);

    const [billing, setBilling] = useState(offered[0]?.key || 'monthly');
    const effective = offered.some((p) => p.key === billing)
        ? billing : (offered[0]?.key || 'monthly');

    const addonByCode = useMemo(() => Object.fromEntries(
        (addons || []).map((a) => [a.code, a])), [addons]);

    return (
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Live card preview
            </Typography>
            {offered.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                    No priced period yet — the pricing page will not render
                    a card for this plan. Price at least one period (0 =
                    Free, -1 = Contact sales).
                </Typography>
            ) : (
                <>
                    <BillingPeriodToggle
                        value={effective}
                        onChange={setBilling}
                        periods={offered}
                        sx={{ mb: 2 }}
                    />
                    <Box sx={{ maxWidth: 360 }}>
                        <PlanCard
                            plan={plan}
                            billing={effective}
                            addonByCode={addonByCode}
                            onSelect={() => {}}
                        />
                    </Box>
                </>
            )}
        </Paper>
    );
}
