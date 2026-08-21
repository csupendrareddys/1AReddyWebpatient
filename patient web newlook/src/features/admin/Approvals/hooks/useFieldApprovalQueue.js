/**
 * useFieldApprovalQueue — data + actions for the field-approval reviewer queue
 * (Profile / Education / Bank Details modules). First consumer of the
 * previously-unused field-approval reviewer RTK hooks.
 */
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
    useGetPendingFieldApprovalsQuery,
    useApproveFieldChangeMutation,
    useRejectFieldChangeMutation,
    useQueryFieldChangeMutation,
} from '../../api/fieldApprovalEndpoints';

const PROFILE_SECTIONS = [
    'personal_details', 'additional_personal_details', 'identity_documents',
    'current_address', 'permanent_address', 'about_me', 'signatures',
    'declaration_documents',
];

export const MODULE_META = {
    profile: { title: 'Profile Field Changes', sections: PROFILE_SECTIONS, excludeInAll: ['education', 'bank_details'] },
    education: { title: 'Education Approvals', fixedSection: 'education' },
    bank: { title: 'Bank Detail Approvals', fixedSection: 'bank_details' },
};

const useFieldApprovalQueue = () => {
    const { moduleKey } = useParams();
    const [searchParams] = useSearchParams();
    const entityType = searchParams.get('entity') || 'doctor';
    const meta = MODULE_META[moduleKey] || MODULE_META.profile;

    const [status, setStatus] = useState('pending');
    const [section, setSection] = useState(meta.fixedSection || 'all');

    const effectiveSection = meta.fixedSection || (section === 'all' ? undefined : section);
    const { data, isLoading, isFetching, refetch } = useGetPendingFieldApprovalsQuery({
        entityType, section: effectiveSection, status,
    });

    let requests = data?.requests || [];
    if (!meta.fixedSection && section === 'all' && meta.excludeInAll) {
        requests = requests.filter((r) => !meta.excludeInAll.includes(r.section));
    }

    const [approve, approveState] = useApproveFieldChangeMutation();
    const [reject, rejectState] = useRejectFieldChangeMutation();
    const [queryChange, queryState] = useQueryFieldChangeMutation();

    return {
        moduleKey, meta, entityType, status, setStatus, section, setSection,
        requests, isLoading: isLoading || isFetching, refetch,
        approve, reject, queryChange,
        busy: approveState.isLoading || rejectState.isLoading || queryState.isLoading,
    };
};

export default useFieldApprovalQueue;
