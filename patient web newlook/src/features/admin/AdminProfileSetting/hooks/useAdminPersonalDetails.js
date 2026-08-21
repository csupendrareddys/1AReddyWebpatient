import { useState, useEffect, useCallback, useRef } from 'react';
import {
    useGetAdminMyProfileQuery,
    useUpdateAdminMyProfileMutation,
    useUpdateAdminExtendedProfileMutation,
} from '../../api/adminProfileConfigEndpoints';
import { toLocalDateString } from '../../../../common/utils/date';

const DEFAULT_FORM_DATA = {
    first_name: '',
    middle_name: '',
    last_name: '',
    phone_number: '',
    email: '',
    dob: null,
    gender: '',
    registration_number: '',
    experience_years: '',
    profile_image: '',
    alternate_phone_number: '',
    alternate_email: '',
    height: '',
    weight: '',
    category: '',
    religion: '',
    citizenship: '',
    languages_known: [],
};

const DEFAULT_DOCUMENT_DATA = {
    aadhar_number: '',
    aadhar_attachment: '',
    pan_number: '',
    pan_attachment: '',
};

const DEFAULT_FEMALE_DATA = {
    LMP_calender: '',
    LMP_remarks: '',
    pregnancy_status: '',
    pregnancy_status_remarks: '',
};

const DEFAULT_COMMUNICATION_DATA = {
    address: '',
    landmark: '',
    city: '',
    district: '',
    state: '',
    pincode: '',
    country: '',
    gps_location: '',
    address_id_proof_type: '',
    address_id_proof_number: '',
    address_id_proof_attachment: '',
};

const DEFAULT_PERMANENT_ADDRESS_DATA = {
    address: '',
    landmark: '',
    city: '',
    district: '',
    state: '',
    pincode: '',
    country: '',
    gps_location: '',
    address_id_proof_type: '',
    address_id_proof_number: '',
    address_id_proof_attachment: '',
};

const useAdminPersonalDetails = (previewMode = false) => {
    const hasPopulated = useRef(false);

    const [formData, setFormDataState] = useState({ ...DEFAULT_FORM_DATA });
    const [documentData, setDocumentDataState] = useState({ ...DEFAULT_DOCUMENT_DATA });
    const [female_data, setFemaleDataState] = useState({ ...DEFAULT_FEMALE_DATA });
    const [communication_data, setCommunicationDataState] = useState({ ...DEFAULT_COMMUNICATION_DATA });
    const [permanent_address_data, setPermanentAddressDataState] = useState({ ...DEFAULT_PERMANENT_ADDRESS_DATA });

    const {
        data: profileData,
        isLoading: profileLoading,
    } = useGetAdminMyProfileQuery(undefined, { skip: previewMode });

    const [updateProfile, { isLoading: updateLoading }] = useUpdateAdminMyProfileMutation();
    const [updateExtended, { isLoading: extendedLoading }] = useUpdateAdminExtendedProfileMutation();

    const loading = previewMode ? false : (profileLoading || updateLoading || extendedLoading);

    // Populate local state from fetched profile data
    useEffect(() => {
        if (previewMode || !profileData || hasPopulated.current) return;
        hasPopulated.current = true;

        try {
            setFormDataState((prev) => ({
                ...prev,
                first_name: profileData.first_name || '',
                middle_name: profileData.middle_name || '',
                last_name: profileData.last_name || '',
                phone_number: profileData.phone || profileData.phone_number || '',
                email: profileData.email || '',
            }));

            const ext = profileData.extended_profile;
            if (ext) {
                setFormDataState((prev) => ({
                    ...prev,
                    dob: ext.dob || null,
                    gender: ext.gender || '',
                    registration_number: ext.registration_number || '',
                    experience_years: ext.experience_years || '',
                    profile_image: ext.profile_image || '',
                    alternate_phone_number: ext.alternative_phone || '',
                    alternate_email: ext.alternative_email || '',
                    height: ext.height || '',
                    weight: ext.weight || '',
                    category: ext.category || '',
                    religion: ext.religion || '',
                    citizenship: ext.citizenship || '',
                    languages_known: ext.languages_known || [],
                }));

                setDocumentDataState({
                    aadhar_number: ext.aadhar_number || '',
                    aadhar_attachment: ext.aadhar_attachment || '',
                    pan_number: ext.pan_number || '',
                    pan_attachment: ext.pan_attachment || '',
                });

                if (ext.female_health_details) {
                    setFemaleDataState({
                        LMP_calender: ext.female_health_details.LMP_calender || '',
                        LMP_remarks: ext.female_health_details.LMP_remarks || '',
                        pregnancy_status: ext.female_health_details.pregnancy_status || '',
                        pregnancy_status_remarks: ext.female_health_details.pregnancy_status_remarks || '',
                    });
                }

                if (ext.communication_address && Object.keys(ext.communication_address).length) {
                    setCommunicationDataState((prev) => ({
                        ...prev,
                        ...ext.communication_address,
                    }));
                }

                if (ext.permanent_address && Object.keys(ext.permanent_address).length) {
                    setPermanentAddressDataState((prev) => ({
                        ...prev,
                        ...ext.permanent_address,
                    }));
                }
            }
        } catch (err) {
            console.error('Failed to populate admin personal details', err);
        }
    }, [profileData, previewMode]);

    // ── Form Handlers ──
    const handleInputChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormDataState((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleDateChange = useCallback((name, date) => {
        setFormDataState((prev) => ({ ...prev, [name]: date }));
    }, []);

    const handleGenderSelect = useCallback((gender) => {
        setFormDataState((prev) => ({ ...prev, gender }));
    }, []);

    const handleSaveProfile = useCallback(async () => {
        try {
            const payload = {
                first_name: formData.first_name,
                middle_name: formData.middle_name,
                last_name: formData.last_name,
                dob: toLocalDateString(formData.dob),
                gender: formData.gender,
                experience_years: formData.experience_years,
            };
            await updateProfile(payload).unwrap();
            return { success: true, message: 'Profile changes submitted for approval!' };
        } catch (err) {
            console.error('Failed to save admin profile', err);
            return { success: false, message: err?.data?.message || err?.message || 'Failed to update profile' };
        }
    }, [formData, updateProfile]);

    // ── Document / Female / Address Handlers ──
    const handleDocumentChange = useCallback((e) => {
        const { name, value } = e.target;
        setDocumentDataState((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleDocumentFileChange = useCallback((name, file) => {
        setDocumentDataState((prev) => ({ ...prev, [name]: file ?? '' }));
    }, []);

    const handleFemaleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFemaleDataState((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleCommunicationChange = useCallback((e) => {
        const { name, value } = e.target;
        setCommunicationDataState((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleCommunicationFileChange = useCallback((name, file) => {
        setCommunicationDataState((prev) => ({ ...prev, [name]: file ?? '' }));
    }, []);

    const handlePermanentAddressChange = useCallback((e) => {
        const { name, value } = e.target;
        setPermanentAddressDataState((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handlePermanentAddressFileChange = useCallback((name, file) => {
        setPermanentAddressDataState((prev) => ({ ...prev, [name]: file ?? '' }));
    }, []);

    const handleCopyCommToPermanent = useCallback(() => {
        setPermanentAddressDataState({ ...communication_data });
    }, [communication_data]);

    const handleSaveExtendedProfile = useCallback(async () => {
        try {
            const payload = {
                // Personal / professional
                dob: toLocalDateString(formData.dob),
                gender: formData.gender || null,
                experience_years: formData.experience_years || null,
                profile_image: formData.profile_image || null,
                registration_number: formData.registration_number || null,
                // Extended fields
                alternative_phone: formData.alternate_phone_number || '',
                alternative_email: formData.alternate_email || '',
                languages_known: formData.languages_known || [],
                height: formData.height || null,
                weight: formData.weight || null,
                category: formData.category || '',
                religion: formData.religion || '',
                citizenship: formData.citizenship || '',
                // Identity documents
                aadhar_number: documentData.aadhar_number || '',
                aadhar_attachment: typeof documentData.aadhar_attachment === 'string' ? documentData.aadhar_attachment : '',
                pan_number: documentData.pan_number || '',
                pan_attachment: typeof documentData.pan_attachment === 'string' ? documentData.pan_attachment : '',
                // Female health
                female_health_details: {
                    LMP_calender: female_data.LMP_calender || '',
                    LMP_remarks: female_data.LMP_remarks || '',
                    pregnancy_status: female_data.pregnancy_status || '',
                    pregnancy_status_remarks: female_data.pregnancy_status_remarks || '',
                },
                // Addresses
                communication_address: { ...communication_data },
                permanent_address: { ...permanent_address_data },
            };

            await updateExtended(payload).unwrap();
            return { success: true, message: 'Extended profile changes submitted for approval!' };
        } catch (err) {
            console.error('Failed to save admin extended profile', err);
            return { success: false, message: err?.data?.message || err?.message || 'Failed to save extended profile' };
        }
    }, [formData, documentData, female_data, communication_data, permanent_address_data, updateExtended]);

    return {
        loading,
        formData,
        documentData,
        female_data,
        communication_data,
        permanent_address_data,
        handleInputChange,
        handleDateChange,
        handleGenderSelect,
        handleSaveProfile,
        handleDocumentChange,
        handleDocumentFileChange,
        handleFemaleChange,
        handleCommunicationChange,
        handleCommunicationFileChange,
        handlePermanentAddressChange,
        handlePermanentAddressFileChange,
        handleCopyCommToPermanent,
        handleSaveExtendedProfile,
    };
};

export default useAdminPersonalDetails;
