/**
 * ResellerPlansPage — "My SaaS Plans": the apex tenant's own plan catalog.
 * The heavy lifting is the SAME PlansAdmin the vendor console uses,
 * pointed at the reseller scope (ownerScope hides vendor-only chrome:
 * categories, plan-type CRUD, is_default, default add-ons) — one plan
 * dialog maintained, not a fork.
 */
import { Container } from '@mui/material';

import PlansAdmin from '../../Pricing/pages/PlansAdmin';
import QuotaCard from '../components/QuotaCard';
import StorefrontCard from '../components/StorefrontCard';
import ResaleLedgerCard from '../components/ResaleLedgerCard';

export default function ResellerPlansPage() {
    return (
        <>
            {/* PlansAdmin mounts its own lg Container; mirror it so the
                quota card lines up with the catalog below. */}
            <Container maxWidth="lg" sx={{ mt: 4 }}>
                <QuotaCard />
                <StorefrontCard />
            <ResaleLedgerCard />
            </Container>
            <PlansAdmin ownerScope="reseller" />
        </>
    );
}
