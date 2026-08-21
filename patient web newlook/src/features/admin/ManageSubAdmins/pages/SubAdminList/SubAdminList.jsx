/**
 * SubAdminList — Sub-admin listing page
 * Pure UI composition — all logic in useManageSubAdmins
 */
import {
    Box, Typography, TextField, InputAdornment, Alert, Snackbar, Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

import useManageSubAdmins from '../../hooks/useManageSubAdmins';
import SubAdminTable from '../../components/SubAdminTable/SubAdminTable';
import './SubAdminList.css';

const SubAdminList = () => {
    const {
        subAdmins,
        hasFullAccess,
        pagination,
        listLoading,
        listError,
        page,
        rowsPerPage,
        search,
        snackbar,
        handleViewDetail,
        handleChangePage,
        handleChangeRowsPerPage,
        handleSearchChange,
        handleCloseSnackbar,
    } = useManageSubAdmins();

    return (
        <Box className="sub-admin-list">
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight={600}>
                    Sub-Admin Management
                </Typography>
                <TextField
                    size="small"
                    placeholder="Search sub-admins..."
                    value={search}
                    onChange={handleSearchChange}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon sx={{ color: '#9ca3af' }} />
                            </InputAdornment>
                        ),
                    }}
                    sx={{ width: 260 }}
                />
                <Box sx={{ ml: 2 }}>
                    {hasFullAccess && ( // hasFullAccess && (
                        <Button
                            variant="contained"
                            color="success"
                            onClick={() => window.location.href = '/dashboard/admin/manage-admins'} // Using href for simplicity, or useNavigate if available in scope
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Create New Sub-Admin
                        </Button>
                    )}
                </Box>
            </Box>

            {listError && <Alert severity="error" sx={{ mb: 2 }}>{listError}</Alert>}

            <SubAdminTable
                subAdmins={subAdmins}
                loading={listLoading}
                pagination={pagination}
                page={page}
                rowsPerPage={rowsPerPage}
                onView={handleViewDetail}
                onPageChange={handleChangePage}
                onRowsPerPageChange={handleChangeRowsPerPage}
            />

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled">
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default SubAdminList;
