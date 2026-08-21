/**
 * LinkOperationDialog — the Operation Page a clinic or hospital opens on a
 * doctor it is linked to in My Link.
 *
 * **A dialog on a real route.** It looks like a modal and closes back to the
 * list, but it is mounted at
 * ``/dashboard/<vertical>/my-link/operate/:doctorId/*`` rather than held in
 * component state, and that is load-bearing rather than stylistic. Half of the
 * doctor profile predates RTK Query — ``createAsyncThunk`` + axios — and those
 * thunks read their scope from ``window.location`` at request time (see
 * ``api/doctorScope.js`` for why a variable was tried and is subtly wrong). A
 * stateful modal has no URL, so every one of those sections would call
 * ``/api/doctor/...`` as the clinic and 403. Closing navigates back, which is
 * also exactly what un-scopes them.
 *
 * **The screens are the doctor's own.** Same bargain the admin Operations
 * detail page struck: rather than a facility-flavoured copy of the profile
 * page, the appointment tables and the prescription hub — surfaces with real
 * validation and approval queues that would drift within a release — this
 * mounts the very same components, inside a ``DoctorScopeProvider`` whose kind
 * is ``link``. Every request re-points to ``/api/facility/link/doctors/<id>/
 * act/...``, where the backend decides what the relationship actually allows.
 * The four boxes below are reused from Operations for the same reason: they
 * are route tables over the doctor's pages, and a second copy would drift.
 *
 * **The tab strip is the server's answer, not ours.** Which sections exist
 * comes from ``/capabilities``, which reads the same ladder the proxy enforces
 * (``app/api/provider_link/authority.py``). A locally-mapped tab strip would
 * be a second opinion on the same question, and the way you'd find out they
 * disagreed is a 403 halfway through someone's work.
 */
import { lazy, Suspense } from 'react';
import {
    Routes, Route, Navigate, useLocation, useNavigate, useParams,
} from 'react-router-dom';
import {
    AppBar, Alert, Box, Button, CircularProgress, Dialog, Stack, Tab, Tabs,
    Toolbar, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import { LINK_SCOPE } from '../../api/doctorScope';
import { DoctorScopeProvider } from
    '../../ProfileSetting/context/DoctorScopeContext';
import { useGetLinkedDoctorCapabilitiesQuery } from '../api/providerLinkEndpoints';

const DoctorProfileSetting = lazy(() => import(
    '../../ProfileSetting/pages/ProfileSetting/ProfileSetting'));
const DoctorOpsBox = lazy(() => import(
    '../../../admin/Operations/components/DoctorOpsBox/DoctorOpsBox'));
const DoctorManageBox = lazy(() => import(
    '../../../admin/Operations/components/DoctorManageBox/DoctorManageBox'));
const DoctorRecordsBox = lazy(() => import(
    '../../../admin/Operations/components/DoctorRecordsBox/DoctorRecordsBox'));
const DoctorChatsBox = lazy(() => import(
    '../../../admin/Operations/components/DoctorChatsBox/DoctorChatsBox'));

/**
 * Section key → the path segment under the dialog's base. ``profile`` is the
 * empty string because it is the index, and because ``ProfileSetting`` keeps
 * its own tab in component state rather than the URL.
 */
const SECTION_PATH = {
    profile: '', appointments: 'appointments', manage: 'manage',
    records: 'records', chats: 'chats',
};

/**
 * The doctor-profile tabs a facility can't reach, by index.
 *
 * 5 Analytics and 6 Attendance & Activity read ``/api/doctor-analytics/<id>/*``
 * and the attendance metrics, which take the doctor as a path parameter and
 * admit an admin or the doctor themselves — a clinic is neither, so they are
 * not proxied and would 403. Hidden rather than left to fail, and worth
 * saying plainly: whether an employer should see a doctor's own performance
 * metrics is a policy question, not a plumbing one, and it isn't answered by
 * "they employ them".
 */
const HIDDEN_PROFILE_TABS = new Set([5, 6]);
const allowProfileTab = (idx) => !HIDDEN_PROFILE_TABS.has(idx);

/**
 * Profile Details sub-tabs, same indexing. 4 is Bank Details, which no tier
 * reaches — ``doctor/profile/bank-accounts`` is on no allowlist, because where
 * a doctor's money lands is not an operational detail an employer settles.
 * Hidden here so the tab isn't offered and then refused.
 */
const allowProfileSubTab = (idx) => idx !== 4;

const Loading = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
    </Box>
);

/**
 * Makes everything inside inert, for a relationship that may look and not
 * touch. One wrapper over all the sections rather than a ``readOnly`` prop
 * threaded through each: the sections are the doctor's own pages, shared with
 * three other surfaces, and adding a mode to every form in them to serve one
 * tier here is how those pages start growing branches nobody can test.
 *
 * ``fieldset[disabled]`` is what actually disables the inputs — it's native,
 * it reaches every descendant control, and it can't be forgotten the way a
 * prop can. ``pointerEvents`` covers the rest: MUI renders Selects and menu
 * triggers as divs, which a disabled fieldset does not stop.
 *
 * It is a second line, not the line. The server refuses every write for this
 * tier regardless (``READ_ONLY_TIERS`` in authority.py) — this is so nobody is
 * invited to attempt one.
 */
const ReadOnlyShell = ({ on, children }) => (on ? (
    <Box
        component="fieldset"
        disabled
        sx={{
            border: 0, p: 0, m: 0, minWidth: 0,
            '& *': { pointerEvents: 'none' },
            // A fieldset disables its descendants without MUI's own greying —
            // that comes from each component's `disabled` prop, which nothing
            // here sets. So the fields are genuinely inert but still look
            // editable; this is the cue that says so.
            opacity: 0.75,
            cursor: 'not-allowed',
        }}
    >
        {children}
    </Box>
) : children);

const LinkOperationDialog = () => {
    const { doctorId } = useParams();
    const navigate = useNavigate();
    const { pathname } = useLocation();

    // The vertical is in the URL we were mounted at — the same clinic-or-
    // hospital dashboard whose My Link page opened us.
    const vertical = pathname.split('/')[2];
    const listPath = `/dashboard/${vertical}/my-link`;
    const basePath = `${listPath}/operate/${doctorId}`;
    const close = () => navigate(listPath);

    const { data: caps, isLoading, isError, error } =
        useGetLinkedDoctorCapabilitiesQuery(doctorId, { skip: !doctorId });

    const sections = caps?.sections || [];
    // Which tab is selected is read from the URL, not held in state, so Back
    // works inside the dialog and a reload lands where you were.
    const rest = pathname.startsWith(basePath)
        ? pathname.slice(basePath.length).replace(/^\//, '')
        : '';
    const segment = rest.split('/')[0] || '';
    const activeIdx = Math.max(
        0, sections.findIndex((s) => SECTION_PATH[s.key] === segment),
    );

    const goTo = (idx) => {
        const key = sections[idx]?.key;
        if (key === undefined) return;
        const suffix = SECTION_PATH[key];
        navigate(suffix ? `${basePath}/${suffix}` : basePath);
    };

    const hasProfile = sections.some((s) => s.key === 'profile');
    const landing = SECTION_PATH[sections[0]?.key] || '';

    return (
        <Dialog open fullScreen onClose={close}>
            <AppBar position="sticky" color="default" elevation={1}>
                <Toolbar sx={{ gap: 2 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="h6" noWrap>
                            {caps?.name || 'Linked doctor'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                            Operation Page{caps?.label ? ` · ${caps.label}` : ''}
                        </Typography>
                    </Box>
                    <Button onClick={close} startIcon={<CloseIcon />}>Close</Button>
                </Toolbar>
            </AppBar>

            <Box sx={{ p: 2 }}>
                {isLoading ? <Loading /> : isError ? (
                    <Alert severity="error">
                        {error?.data?.message
                            || "This doctor isn't linked to you, or the link was removed."}
                    </Alert>
                ) : sections.length === 0 ? (
                    <Stack spacing={2}>
                        <Alert severity="info">{caps?.summary}</Alert>
                        <Box><Button variant="outlined" onClick={close}>Back to My Link</Button></Box>
                    </Stack>
                ) : (
                    <>
                        <Alert severity={caps?.read_only ? 'info' : 'warning'} sx={{ mb: 2 }}>
                            {caps?.read_only ? (
                                <>
                                    You&apos;re viewing this doctor&apos;s own screens under a{' '}
                                    <b>{caps?.label}</b> relationship. {caps?.summary}
                                </>
                            ) : (
                                <>
                                    You&apos;re acting <b>on this doctor&apos;s behalf</b> under
                                    an <b>{caps?.label}</b> relationship — these are their own
                                    screens, and what you save here is saved as theirs.{' '}
                                    {caps?.summary}
                                </>
                            )}
                        </Alert>

                        <Tabs
                            value={activeIdx}
                            onChange={(_, v) => goTo(v)}
                            variant="scrollable"
                            scrollButtons="auto"
                            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
                        >
                            {sections.map((s) => <Tab key={s.key} label={s.label} />)}
                        </Tabs>

                        <DoctorScopeProvider
                            doctorId={doctorId}
                            scopeKind={LINK_SCOPE}
                            basePath={basePath}
                        >
                            <Suspense fallback={<Loading />}>
                                <ReadOnlyShell on={!!caps?.read_only}>
                                    <Routes>
                                        <Route path="appointments/*" element={<DoctorOpsBox />} />
                                        <Route path="manage" element={<DoctorManageBox />} />
                                        <Route path="records/*" element={<DoctorRecordsBox />} />
                                        <Route path="chats" element={<DoctorChatsBox />} />
                                        {/* Profile is the index, but only when
                                            the relationship includes it — an
                                            Associate lands on their first
                                            granted tab instead of on a page
                                            that would 403 field by field. */}
                                        <Route
                                            path="*"
                                            element={hasProfile ? (
                                                <DoctorProfileSetting
                                                    allowTab={allowProfileTab}
                                                    allowSubTab={allowProfileSubTab}
                                                    readOnly={!!caps?.read_only}
                                                />
                                            ) : (
                                                <Navigate to={`${basePath}/${landing}`} replace />
                                            )}
                                        />
                                    </Routes>
                                </ReadOnlyShell>
                            </Suspense>
                        </DoctorScopeProvider>
                    </>
                )}
            </Box>
        </Dialog>
    );
};

export default LinkOperationDialog;
