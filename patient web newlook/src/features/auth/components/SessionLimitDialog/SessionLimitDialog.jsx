import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    CircularProgress,
    Alert,
    Box,
    Chip,
    Divider,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DevicesIcon from '@mui/icons-material/Devices';
import LogoutIcon from '@mui/icons-material/Logout';
import axiosInstance from '../../../../api/axiosConfig';

const SessionLimitDialog = ({ open, onClose, credentials, onSuccess }) => {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        if (open && credentials) {
            fetchSessions();
        }
    }, [open, credentials]);

    const fetchSessions = async () => {
        setLoading(true);
        setError('');
        try {
            const response = await axiosInstance.post('/auth/active-sessions', credentials);
            setSessions(response.data.data.sessions || []);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to fetch sessions');
        } finally {
            setLoading(false);
        }
    };

    const handleLogoutAll = async () => {
        setActionLoading(true);
        setError('');
        try {
            await axiosInstance.post('/auth/force-logout-all', credentials);
            setSuccess('All sessions logged out! You can now login.');
            setSessions([]);
            setTimeout(() => {
                onSuccess?.();
                onClose();
            }, 1500);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to logout');
        } finally {
            setActionLoading(false);
        }
    };

    const handleLogoutSession = async (sessionId) => {
        setActionLoading(true);
        setError('');
        try {
            await axiosInstance.post('/auth/force-logout-session', {
                ...credentials,
                session_id: sessionId,
            });
            // Remove from local state
            setSessions(prev => prev.filter(s => s.session_id !== sessionId));
            setSuccess('Session logged out!');
            setTimeout(() => setSuccess(''), 2000);

            // If no more sessions, close and allow login
            if (sessions.length <= 1) {
                setTimeout(() => {
                    onSuccess?.();
                    onClose();
                }, 1000);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to logout session');
        } finally {
            setActionLoading(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    const parseDeviceInfo = (deviceInfo) => {
        if (!deviceInfo) return { browser: 'Unknown', ip: 'Unknown' };
        try {
            const info = typeof deviceInfo === 'string' ? JSON.parse(deviceInfo) : deviceInfo;
            const userAgent = info.user_agent || '';
            // Simple browser detection
            let browser = 'Unknown Browser';
            if (userAgent.includes('Chrome')) browser = 'Chrome';
            else if (userAgent.includes('Firefox')) browser = 'Firefox';
            else if (userAgent.includes('Safari')) browser = 'Safari';
            else if (userAgent.includes('Edge')) browser = 'Edge';

            return {
                browser,
                ip: info.ip || 'Unknown IP',
                userAgent,
            };
        } catch {
            return { browser: 'Unknown', ip: 'Unknown' };
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DevicesIcon color="warning" />
                Session Limit Reached
            </DialogTitle>
            <DialogContent>
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Maximum session limit reached. Please logout from existing devices to continue.
                </Alert>

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                {success && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        {success}
                    </Alert>
                )}

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                            Active Sessions ({sessions.length})
                        </Typography>
                        <List dense>
                            {sessions.map((session, index) => {
                                const device = parseDeviceInfo(session.device_fingerprint);
                                return (
                                    <Box key={session.session_id || index}>
                                        <ListItem>
                                            <ListItemText
                                                primary={
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        {device.browser}
                                                        {session.is_current && (
                                                            <Chip label="Current" size="small" color="primary" />
                                                        )}
                                                    </Box>
                                                }
                                                secondary={
                                                    <>
                                                        <Typography variant="caption" display="block">
                                                            IP: {device.ip}
                                                        </Typography>
                                                        <Typography variant="caption" display="block">
                                                            Created: {formatDate(session.created_at)}
                                                        </Typography>
                                                    </>
                                                }
                                            />
                                            <ListItemSecondaryAction>
                                                <IconButton
                                                    edge="end"
                                                    onClick={() => handleLogoutSession(session.session_id)}
                                                    disabled={actionLoading}
                                                    color="error"
                                                    title="Logout this session"
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            </ListItemSecondaryAction>
                                        </ListItem>
                                        {index < sessions.length - 1 && <Divider />}
                                    </Box>
                                );
                            })}
                        </List>
                    </>
                )}
            </DialogContent>
            <DialogActions sx={{ p: 2, gap: 1 }}>
                <Button onClick={onClose} disabled={actionLoading}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    startIcon={actionLoading ? <CircularProgress size={16} /> : <LogoutIcon />}
                    onClick={handleLogoutAll}
                    disabled={actionLoading || sessions.length === 0}
                >
                    Logout All Devices
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SessionLimitDialog;
