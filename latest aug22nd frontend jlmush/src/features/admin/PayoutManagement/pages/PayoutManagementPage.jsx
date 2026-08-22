/**
 * PayoutManagementPage — the unified, tenant-wide Payout Management page.
 * One page, split into sections by compensation model rather than separate
 * pages per model:
 *
 *   Plan-Based   — per-patient payouts from PLAN doctors
 *   Employee     — fixed salary payouts (kind=salary), with Adjust/Push
 *   Consultancy  — retainer payouts (kind=retainer) PLUS the consultant's
 *                  above-target per-appointment incentive payouts
 *   Needs Bank Verification — unchanged, applies to the per-patient rail
 *
 * Each section is a self-contained component (see ./components/) — this page
 * is just the Tabs shell + the tenant-wide Reconcile action + the shared
 * snackbar. Employees never earn a per-patient payout (they're salaried), so
 * there is no per-patient table on the Employee tab.
 */
import { useState } from 'react';
import { Box, Typography, Tabs, Tab, Snackbar, Alert, Button, Tooltip, Stack } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { useReconcilePayoutsMutation } from '../../api/payoutEndpoints';
import PerPatientPayoutsTable from '../components/PerPatientPayoutsTable';
import SalaryPayoutsTable from '../components/SalaryPayoutsTable';
import NeedsBankTable from '../components/NeedsBankTable';
import VerifiedBanksTable from '../components/VerifiedBanksTable';

const PayoutManagementPage = () => {
    const [activeTab, setActiveTab] = useState(0);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
    const [reconcilePayouts, { isLoading: isReconciling }] = useReconcilePayoutsMutation();

    const showSnack = (message, severity = 'success') => setSnackbar({ open: true, message, severity });

    const handleReconcile = async () => {
        try {
            const res = await reconcilePayouts().unwrap();
            showSnack(res.message || 'Reconciled with Cashfree', 'info');
        } catch (err) {
            showSnack(err?.data?.message || 'Reconcile failed', 'error');
        }
    };

    return (
        <Box sx={{ py: 3, px: 2 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
                Payout Management
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 3 }}>
                <Typography variant="body2" color="text.secondary">
                    Every doctor's payouts across the tenant, grouped below by how they're paid.
                    Pushing a payout does not send money — the doctor collecting or claiming it does.
                </Typography>
                <Tooltip title="Ask Cashfree for the final status of every in-flight payout (both per-patient and salary/retainer)">
                    <span>
                        <Button
                            size="small" variant="outlined" startIcon={<SyncIcon />}
                            disabled={isReconciling} onClick={handleReconcile} sx={{ whiteSpace: 'nowrap' }}
                        >
                            {isReconciling ? 'Checking…' : 'Reconcile'}
                        </Button>
                    </span>
                </Tooltip>
            </Box>

            <Tabs
                value={activeTab} onChange={(e, v) => setActiveTab(v)} sx={{ mb: 3 }}
                variant="scrollable" scrollButtons="auto"
            >
                <Tab label="Plan-Based" />
                <Tab label="Group Plan Payouts" />
                <Tab label="Service Payouts" />
                <Tab label="Employee" />
                <Tab label="Consultancy" />
                <Tab label="Second Opinion" />
                <Tab label="Needs Bank Verification" />
            </Tabs>

            {/* ═══════ Plan-Based (appointment payouts) ═══════ */}
            {activeTab === 0 && (
                <PerPatientPayoutsTable
                    billingType="plan" sourceType="appointment"
                    emptyMessage="No plan-based appointment payouts found."
                    onNotify={showSnack}
                />
            )}

            {/* ═══════ Group Offering plan payouts ═══════ */}
            {activeTab === 1 && (
                <PerPatientPayoutsTable
                    sourceType="plan_installment"
                    title="Group Plan Payouts (per doctor, per installment)"
                    emptyMessage="No group offering plan payouts yet."
                    onNotify={showSnack}
                />
            )}

            {/* ═══════ Individual service order payouts ═══════ */}
            {activeTab === 2 && (
                <PerPatientPayoutsTable
                    sourceType="service_order"
                    title="Service Payouts (individual products)"
                    emptyMessage="No service order payouts yet."
                    onNotify={showSnack}
                />
            )}

            {/* ═══════ Employee ═══════ */}
            {activeTab === 3 && (
                <SalaryPayoutsTable
                    kind="salary"
                    title="Employee Salaries"
                    emptyMessage="No employee salary payouts yet. Generate one from the doctor's Profile & Schedule → Analytics & Settings → Admin: Payout."
                    onNotify={showSnack}
                />
            )}

            {/* ═══════ Consultancy ═══════ */}
            {activeTab === 4 && (
                <Stack spacing={4}>
                    <SalaryPayoutsTable
                        kind="retainer"
                        title="Consultant Retainers"
                        emptyMessage="No consultant retainer payouts yet. Generate one from the doctor's Profile & Schedule → Analytics & Settings → Admin: Payout."
                        onNotify={showSnack}
                    />
                    <PerPatientPayoutsTable
                        billingType="consultant" sourceType="appointment"
                        title="Above-Target Incentives (Per-Appointment)"
                        emptyMessage="No above-target incentive payouts found."
                        onNotify={showSnack}
                    />
                </Stack>
            )}

            {/* ═══════ Second Opinion (family-doctor credit redemptions) ═══════ */}
            {activeTab === 5 && (
                <PerPatientPayoutsTable
                    sourceType="second_opinion"
                    title="Second Opinion Credit Redemptions"
                    emptyMessage="No second-opinion credit redemptions yet."
                    onNotify={showSnack}
                />
            )}

            {/* ═══════ Needs Bank Verification + verified accounts ═══════ */}
            {activeTab === 6 && (
                <Stack spacing={4}>
                    <NeedsBankTable onNotify={showSnack} />
                    <VerifiedBanksTable />
                </Stack>
            )}

            <Snackbar
                open={snackbar.open} autoHideDuration={4000}
                onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity={snackbar.severity}
                    onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                    variant="filled"
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default PayoutManagementPage;
