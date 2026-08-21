/**
 * MyLinkPage — professional affiliations (My Link), in two tabs.
 *
 * **Affiliations** is the original page: the same connection engine as My
 * Network but a distinct 'link' context, each connection classified by a
 * Relationship type — Partner / Associate / Employee for clinics & hospitals,
 * Partner / Associate for individual doctors.
 *
 * **Support Staff** is the half that was missing. Every affiliation above is
 * between two accounts that already exist on the platform, so a receptionist
 * or a billing clerk — who has no account — could not be recorded at all, and
 * "Employee" quietly meant "employee who happens to be a registered
 * practitioner". Support staff are the rest of the people who work here.
 *
 * **Affiliations reads from whichever end you're on.** A My Link row is owned
 * by the DOCTOR — the facility is its target — so a clinic cannot use the
 * doctor's endpoints to see its own affiliations. ``ConnectionManager`` serves
 * the Individual tab from the facility's endpoint instead, and puts the
 * Operation Page on those rows. Deliberately NOT a separate tab: "the clinics
 * I'm affiliated with" and "the doctors affiliated with me" are one list seen
 * from two sides, and a second tab would teach people that My Link means
 * something different depending on who signed in.
 *
 * **Roles** is what Support Staff assigns from. Shared roles are the platform
 * administrator's and read-only here; a practice can also author its own,
 * which is why this is an editor rather than a list.
 *
 * One page rather than three, because from the provider's side it is the same
 * question — who works with me, and in what capacity. Splitting it would mean
 * learning that whether a colleague has a platform account decides which
 * screen they live on.
 *
 * The ``<Outlet />`` at the bottom is the Operation Page, a full-screen dialog
 * on a nested route. See ``LinkOperationDialog`` for why it needs a URL of its
 * own rather than a piece of state.
 */
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Box, Paper, Tab, Tabs } from '@mui/material';
import HandshakeIcon from '@mui/icons-material/Handshake';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import { useSelector } from 'react-redux';

import ConnectionManager from '../../MyNetwork/components/ConnectionManager';
import StaffRolesSection from '../components/StaffRolesSection';
import SupportStaffSection from '../components/SupportStaffSection';

// What to call the practice in the staff copy, per signed-in role.
const PROVIDER_LABEL = {
    doctor: 'practice', clinic: 'clinic', hospital: 'hospital',
};

const MyLinkPage = () => {
    const [tab, setTab] = useState(0);
    const role = useSelector((s) => s.auth?.user?.role);
    const isFacility = role === 'clinic' || role === 'hospital';
    const providerLabel = PROVIDER_LABEL[role] || 'practice';

    return (
        <Box>
            <Paper sx={{ mb: 2 }}>
                <Tabs value={tab} onChange={(_, v) => setTab(v)}
                    variant="scrollable" scrollButtons="auto">
                    <Tab label="Affiliations" icon={<HandshakeIcon />} iconPosition="start" />
                    <Tab label="Support Staff" icon={<BadgeOutlinedIcon />} iconPosition="start" />
                    <Tab label="Roles" icon={<VerifiedUserOutlinedIcon />} iconPosition="start" />
                </Tabs>
            </Paper>

            {/* Mounted only while selected. ConnectionManager owns a fair
                amount of its own fetching, and paying for it to sit behind the
                staff tab buys nothing. */}
            {tab === 0 && (
                <ConnectionManager
                    context="link"
                    title="My Link"
                    subtitle={isFacility
                        ? 'The practitioners affiliated with you, and what each relationship lets you do on their behalf.'
                        : 'Manage your professional affiliations with clinics, hospitals, and fellow practitioners.'}
                    removeLabel="Delink"
                    // A doctor delinking a clinic is revoking that clinic's
                    // control over their practice, which is not the same act
                    // as tidying a list — see LinkOperationDialog. Only the
                    // doctor can do it, so the warning has to be here.
                    removeWarning={
                        'If this is a clinic or hospital, delinking immediately '
                        + 'ends their access to your practice through their '
                        + 'Operation Page. They cannot re-add you — only you can '
                        + 'send the affiliation again.'
                    }
                    classification={{
                        field: 'relationship_type',
                        label: 'Relationship',
                        optionsByType: {
                            doctor: ['Partner', 'Associate'],
                            hospital: ['Partner', 'Associate', 'Employee'],
                            clinic: ['Partner', 'Associate', 'Employee'],
                        },
                    }}
                />
            )}
            {tab === 1 && (
                <SupportStaffSection
                    providerLabel={PROVIDER_LABEL[role] || 'practice'}
                    showBranches={role === 'clinic'}
                />
            )}
            {tab === 2 && (
                <StaffRolesSection providerLabel={providerLabel} />
            )}

            <Outlet />
        </Box>
    );
};

export default MyLinkPage;
