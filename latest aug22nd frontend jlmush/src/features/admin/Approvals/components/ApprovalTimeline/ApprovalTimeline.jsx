/**
 * ApprovalTimeline — Vertical timeline of approval actions
 * Pure UI component
 */
import { Box, Typography, Chip, Avatar, Paper } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpIcon from '@mui/icons-material/Help';
import ReplyIcon from '@mui/icons-material/Reply';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import PendingIcon from '@mui/icons-material/Pending';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';

const ACTION_ICONS = {
    approve: { icon: ThumbUpIcon, color: '#16a34a' },
    reject: { icon: CancelIcon, color: '#dc2626' },
    cancel: { icon: CancelIcon, color: '#6b7280' },
    query: { icon: HelpIcon, color: '#eab308' },
    respond: { icon: ReplyIcon, color: '#2563eb' },
    escalate: { icon: ArrowUpwardIcon, color: '#9333ea' },
    submit: { icon: PendingIcon, color: '#E8833A' },
};

const ApprovalTimeline = ({ actions }) => {
    if (!actions || actions.length === 0) {
        return (
            <Box>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                    Activity Timeline
                </Typography>
                <Typography color="text.secondary" variant="body2">
                    No actions recorded yet.
                </Typography>
            </Box>
        );
    }

    return (
        <Box>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Activity Timeline
            </Typography>
            <Box sx={{ position: 'relative', pl: 4 }}>
                {/* Vertical line */}
                <Box
                    sx={{
                        position: 'absolute',
                        left: 14,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        bgcolor: '#e5e7eb',
                    }}
                />

                {actions.map((action, index) => {
                    const config = ACTION_ICONS[action.action] || ACTION_ICONS.submit;
                    const Icon = config.icon;

                    return (
                        <Box
                            key={action.id || index}
                            sx={{
                                position: 'relative',
                                mb: 3,
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 2,
                            }}
                        >
                            {/* Dot */}
                            <Avatar
                                sx={{
                                    width: 28,
                                    height: 28,
                                    bgcolor: config.color,
                                    position: 'absolute',
                                    left: -26,
                                    top: 4,
                                }}
                            >
                                <Icon sx={{ fontSize: 16, color: 'white' }} />
                            </Avatar>

                            {/* Content */}
                            <Paper sx={{ p: 2, flex: 1, borderRadius: 2, bgcolor: '#fafafa' }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography fontWeight={600} sx={{ textTransform: 'capitalize' }}>
                                        {action.action?.replace(/_/g, ' ')}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {action.created_at
                                            ? new Date(action.created_at).toLocaleString()
                                            : ''}
                                    </Typography>
                                </Box>
                                <Typography variant="body2" color="text.secondary">
                                    by {action.admin_name || action.admin_id?.slice(0, 8) || 'System'}
                                    {action.level != null && ` · Level ${action.level}`}
                                </Typography>
                                {action.comments && (
                                    <Typography variant="body2" sx={{ mt: 1, p: 1, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                                        {action.comments}
                                    </Typography>
                                )}
                            </Paper>
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
};

export default ApprovalTimeline;
