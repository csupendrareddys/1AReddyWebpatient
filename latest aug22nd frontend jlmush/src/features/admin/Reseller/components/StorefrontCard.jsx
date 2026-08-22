/**
 * StorefrontCard — presentation knobs for the apex's own selling site.
 *
 * Currently one switch: show or hide the "SaaS Pricing" entry in the
 * storefront's public nav. Label-level only, by design: turning it off
 * does not close /pricing or the signup flow, and child tenants are
 * never affected — they don't render the entry in the first place.
 */
import {
    Card, CardContent, FormControlLabel, Switch, Typography,
} from '@mui/material';

import {
    useGetResellerStorefrontQuery,
    useUpdateResellerStorefrontMutation,
} from '../../api/pricingEndpoints';

export default function StorefrontCard() {
    const { data, isLoading } = useGetResellerStorefrontQuery();
    const [update, { isLoading: saving }] = useUpdateResellerStorefrontMutation();

    const show = data?.show_pricing_nav !== false;

    return (
        <Card sx={{ mt: 2 }}>
            <CardContent>
                <Typography variant="h6" gutterBottom>Storefront</Typography>
                <FormControlLabel
                    control={(
                        <Switch
                            checked={show}
                            disabled={isLoading || saving}
                            onChange={(e) => update({ show_pricing_nav: e.target.checked })}
                        />
                    )}
                    label='Show the "SaaS Pricing" link in my site&apos;s navigation'
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Hides only the menu label on your public site. Your pricing page
                    and tenant signup keep working, and your existing tenants are
                    not affected.
                </Typography>
            </CardContent>
        </Card>
    );
}
