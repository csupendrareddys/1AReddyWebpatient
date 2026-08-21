/**
 * MyPurchases — Patient view of their marketplace orders.
 *
 * Rendered standalone, and ``embedded`` from the patient dashboard's
 * "My Appointments / Services" → Service List toggle, where the page
 * chrome (outer padding + big title) is supplied by the host section.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Table, TableHead, TableRow, TableCell,
    TableBody, TableContainer, Chip, CircularProgress, Stack, Divider,
    Tabs, Tab, Button,
} from '@mui/material';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import PaymentsIcon from '@mui/icons-material/Payments';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { Collapse, Link as MuiLink } from '@mui/material';
import {
    useGetPatientMarketplaceOrdersQuery,
    useListMyServiceChannelsQuery,
} from '../../../api/scopedBookingApi';
import OfferingFeatures from '../../../components/OfferingFeatures/OfferingFeatures';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePatientCheckout from '../../../api/usePatientCheckout';

// Patient-facing lifecycle: you pay at booking (pending → paid), the provider
// then accepts (under_process = active) or rejects.
const STATUS_META = {
    pending: { label: 'PAYMENT PENDING', color: 'warning', hint: 'Finish payment to send your request.' },
    paid: { label: 'AWAITING PROVIDER', color: 'info', hint: 'Paid — waiting for the provider to accept.' },
    under_process: { label: 'ACTIVE', color: 'success', hint: 'Accepted — open it under Service Chats.' },
    completed: { label: 'COMPLETED', color: 'default', hint: '' },
    rejected: { label: 'DECLINED', color: 'error', hint: 'The provider declined this request.' },
    cancelled: { label: 'CANCELLED', color: 'error', hint: '' },
    accepted: { label: 'AWAITING PROVIDER', color: 'info', hint: '' },
};

// Status buckets, mirroring the appointment list's tabs. "In Process" leads —
// it's the bucket a patient actually acts on (that's where Service Chat lives).
const SERVICE_TABS = [
    { key: 'active', label: 'In Process', statuses: ['under_process'] },
    // Unpaid orders used to be reachable only under "All". They're the most
    // actionable bucket there is — one click from being sent to the provider —
    // so they get their own tab, second rather than first so the default
    // landing tab doesn't move.
    { key: 'pending', label: 'Payment Pending', statuses: ['pending'] },
    { key: 'awaiting', label: 'Awaiting Provider', statuses: ['paid', 'accepted'] },
    { key: 'completed', label: 'Completed', statuses: ['completed'] },
    { key: 'all', label: 'All', statuses: null },
];

function OrderRow({ order, meta, chat, navigate }) {
    const { basePath } = usePatientScope();
    const [detailsOpen, setDetailsOpen] = useState(false);
    const isActive = (order.status || '').toLowerCase() === 'under_process';
    const m = meta(order.status);

    // A 'pending' order is booked but unpaid — either an abandoned checkout or
    // one an admin created from Operations for the patient to settle. The row
    // used to say "Finish payment to send your request" with nothing to click,
    // which made that a dead end. Same checkout the marketplace runs.
    const isUnpaid = (order.status || '').toLowerCase() === 'pending';
    const [paying, setPaying] = useState(false);
    const [payError, setPayError] = useState(null);
    const { checkout } = usePatientCheckout();
    const payNow = async () => {
        setPaying(true);
        setPayError(null);
        try {
            await checkout({ orderId: order.id, description: order.product_name });
        } catch (e) {
            setPayError(e?.data?.error || e?.data?.message || e?.message || 'Payment failed.');
        } finally {
            setPaying(false);
        }
    };
    return (
        <>
            <TableRow>
                <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {order.id.substring(0, 8)}...
                    </Typography>
                </TableCell>
                <TableCell>
                    <Typography variant="subtitle2">{order.product_name}</Typography>
                    {order.doctor_notes && (
                        <Box mt={1} p={1} bgcolor="#fff4e5" borderRadius={1} border="1px solid #ffd180">
                            <Typography variant="caption" fontWeight="bold" color="warning.dark" display="block">
                                DR. QUERY:
                            </Typography>
                            <Typography variant="caption" color="text.primary">{order.doctor_notes}</Typography>
                        </Box>
                    )}
                    <Button size="small" variant="text" startIcon={detailsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        onClick={() => setDetailsOpen((o) => !o)} sx={{ mt: 0.5, textTransform: 'none' }}>
                        Details
                    </Button>
                </TableCell>
                <TableCell>
                    {order.doctor_id ? (
                        <MuiLink component="button" variant="body2" underline="hover"
                            onClick={() => navigate(`${basePath}/doctor/${order.doctor_id}`)}>
                            Dr. {order.doctor_name}
                        </MuiLink>
                    ) : (
                        <Typography variant="body2">Dr. {order.doctor_name}</Typography>
                    )}
                </TableCell>
                <TableCell align="right">
                    <Typography variant="body2" fontWeight="600">₹{order.price_at_purchase}</Typography>
                </TableCell>
                <TableCell>
                    <Typography variant="body2">{new Date(order.created_at).toLocaleDateString()}</Typography>
                </TableCell>
                <TableCell align="center">
                    <Chip label={m.label} color={m.color} size="small" sx={{ fontWeight: 'bold' }} />
                </TableCell>
                <TableCell align="center">
                    {isUnpaid ? (
                        <>
                            <Button size="small" variant="contained" color="warning"
                                startIcon={<PaymentsIcon />} disabled={paying} onClick={payNow}>
                                {paying ? 'Processing…' : `Pay ₹${order.price_at_purchase}`}
                            </Button>
                            {payError && (
                                <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                                    {payError}
                                </Typography>
                            )}
                        </>
                    ) : isActive && chat ? (
                        <Button size="small" variant="outlined" startIcon={<ForumOutlinedIcon />}
                            onClick={() => navigate(`${basePath}/my-services?channel=${chat.id}`)}>
                            Service Chat
                        </Button>
                    ) : isActive ? (
                        <Typography variant="caption" color="text.secondary">No chat for this service</Typography>
                    ) : (
                        <Typography variant="caption" color="text.secondary">{m.hint || '—'}</Typography>
                    )}
                </TableCell>
            </TableRow>
            <TableRow>
                <TableCell colSpan={7} sx={{ py: 0, borderBottom: detailsOpen ? undefined : 'none' }}>
                    <Collapse in={detailsOpen} unmountOnExit>
                        <Box sx={{ py: 1.5 }}>
                            <OfferingFeatures
                                offering={order.offering_type === 'group' ? 'group' : 'service'}
                                productId={order.product_id}
                                doctorId={order.doctor_id}
                                variant="plain"
                                title="Benefits & how it works"
                            />
                        </Box>
                    </Collapse>
                </TableCell>
            </TableRow>
        </>
    );
}

const MyPurchases = ({ embedded = false }) => {
    const { data: orders = [], isLoading } = useGetPatientMarketplaceOrdersQuery();
    const [tab, setTab] = useState(0);
    const navigate = useNavigate();

    // Not every service talks: a channel only exists once a communication-
    // enabled service was activated, and even then ``chat_enabled`` may be off
    // (a calls-or-documents-only product). So the Service Chat button is driven
    // by the channel list, not by the order's status — no channel, no button,
    // and the link carries the channel's own id so it can't land on the wrong
    // conversation. Group orders yield several channels sharing one order id;
    // the group chat is the one everybody is in, so it wins.
    const { data: channels = [] } = useListMyServiceChannelsQuery();
    const chatByOrderId = useMemo(() => {
        const byOrder = new Map();
        channels.forEach((c) => {
            const ps = c.purchased_service;
            if (!ps?.order_id || !ps.chat_enabled) return;
            if (c.status === 'archived') return;
            const current = byOrder.get(ps.order_id);
            if (!current || (c.kind === 'group' && current.kind !== 'group')) {
                byOrder.set(ps.order_id, c);
            }
        });
        return byOrder;
    }, [channels]);

    if (isLoading) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    const meta = (status) => STATUS_META[(status || '').toLowerCase()]
        || { label: (status || '').toUpperCase(), color: 'default', hint: '' };

    const inBucket = (t, o) => !t.statuses || t.statuses.includes((o.status || '').toLowerCase());
    const activeTab = SERVICE_TABS[tab] || SERVICE_TABS[SERVICE_TABS.length - 1];
    const visibleOrders = orders.filter((o) => inBucket(activeTab, o));

    return (
        <Box sx={{ p: embedded ? 0 : 4 }}>
            {!embedded && (
                <Stack direction="row" spacing={1} alignItems="center" mb={4}>
                    <ShoppingBagIcon color="primary" sx={{ fontSize: 32 }} />
                    <Typography variant="h4" fontWeight="bold">My Services</Typography>
                </Stack>
            )}

            <Paper sx={{ p: 3, borderRadius: 2 }}>
                <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{ mb: 2 }}
                >
                    {SERVICE_TABS.map((t) => {
                        const n = orders.filter((o) => inBucket(t, o)).length;
                        return <Tab key={t.key} label={`${t.label} (${n})`} />;
                    })}
                </Tabs>
                <Divider sx={{ mb: 2 }} />

                <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell><b>Order ID</b></TableCell>
                            <TableCell><b>Product</b></TableCell>
                            <TableCell><b>Doctor</b></TableCell>
                            <TableCell align="right"><b>Price (₹)</b></TableCell>
                            <TableCell><b>Date</b></TableCell>
                            <TableCell align="center"><b>Status</b></TableCell>
                            <TableCell align="center"><b>Action</b></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {visibleOrders.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7} align="center">
                                    <Typography color="text.secondary" py={4}>
                                        No services in this view.
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        {visibleOrders.map((order) => (
                            <OrderRow
                                key={order.id}
                                order={order}
                                meta={meta}
                                chat={chatByOrderId.get(order.id)}
                                navigate={navigate}
                            />
                        ))}
                    </TableBody>
                </Table>
                </TableContainer>
            </Paper>
        </Box>
    );
};

export default MyPurchases;
