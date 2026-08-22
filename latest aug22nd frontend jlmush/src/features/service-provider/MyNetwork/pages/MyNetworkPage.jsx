/**
 * MyNetworkPage — Care Connect Associates (care/referral network).
 * Connect with fellow doctors, hospitals, and clinics; each connection is
 * classified by a Referral type (A/B/C). Connected doctors are the source for
 * the group-service-offering co-doctor picker.
 */
import ConnectionManager from '../components/ConnectionManager';

const MyNetworkPage = () => (
    <ConnectionManager
        context="network"
        title="My Network"
        subtitle="Care Connect Associates — connect with fellow doctors, hospitals and clinics. Connected doctors can be added to your group service offerings."
        classification={{
            field: 'referral_type',
            label: 'Referral',
            optionsByType: { doctor: ['A', 'B', 'C'], hospital: ['A', 'B', 'C'], clinic: ['A', 'B', 'C'] },
        }}
    />
);

export default MyNetworkPage;
