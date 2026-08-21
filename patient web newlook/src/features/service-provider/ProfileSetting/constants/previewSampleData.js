// Static sample data for admin preview mode (no real doctor session)
// Used by per-domain hooks when previewMode=true to skip API calls
const PREVIEW_SAMPLE_DATA = {
    formData: {
        first_name: 'Dr. John', middle_name: '', last_name: 'Doe',
        email: 'doctor@example.com', phone_number: '+91 98765 43210',
        gender: 'male', dob: '1985-06-15', registration_number: 'MCI-12345',
        experience_years: '12', specialization: 'General Medicine',
        alternate_phone_number: '+91 91234 56789', alternate_email: 'john.doe@clinic.com',
        height: '175', weight: '72', category: 'General', religion: 'Hindu',
        citizenship: 'Indian', languages_known: ['English', 'Hindi', 'Telugu'],
        slotPricing: [{ duration: 15, price: 500 }, { duration: 30, price: 900 }],
    },
    documentData: { aadhar_number: '1234 5678 9012', pan_number: 'ABCDE1234F', aadhar_attachment: '', pan_attachment: '' },
    female_data: { LMP_calender: '', LMP_remarks: '', pregnancy_status: '', pregnancy_status_remarks: '' },
    communication_data: { address: '123 Medical Street', landmark: 'Near City Hospital', city: 'Hyderabad', state: 'Telangana', pincode: '500001', country: 'India' },
    permanent_address_data: { address: '123 Medical Street', landmark: 'Near City Hospital', city: 'Hyderabad', state: 'Telangana', pincode: '500001', country: 'India' },
    availabilityConfig: { slot_size: 15 },
    availabilityApprovalStatus: 'approved',
    availabilityRejectionReason: '',
    availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    availableSlots: {},
    signaturesState: {
        signature1: { file: null, preview: null, fileName: '', serverUrl: '' },
        signature2: { file: null, preview: null, fileName: '', serverUrl: '' },
        digitalSignature: { file: null, preview: null, fileName: '', serverUrl: '' },
        isSubmitting: false,
    },
    aboutState: {
        briefAbout: { text: 'Experienced physician with 12+ years in general medicine.', attachment: null, preview: null, attachmentName: '', serverUrl: '' },
        natureOfWork: { text: 'Outpatient consultation and chronic disease management.', attachment: null, preview: null, attachmentName: '', serverUrl: '' },
        currentlyWorkingWith: { text: 'City Hospital, Hyderabad.', attachment: null, preview: null, attachmentName: '', serverUrl: '' },
        isSubmitting: false,
    },
    educationState: {
        graduation: { degree: 'MBBS', specialization: 'General Medicine', state: 'Telangana', university: 'Osmania University', institute: 'Osmania Medical College', yearOfGraduation: '2010', evaluationCriteria: 'Percentage', obtainedScore: '78', registrationNumber: 'MCI-12345', certificate: { file: null, preview: null, fileName: '' }, marksheet: { file: null, preview: null, fileName: '' } },
        postGraduation: { degree: 'MD', specialization: 'Internal Medicine', state: '', university: '', institute: '', yearOfGraduation: '', evaluationCriteria: '', obtainedScore: '', registrationNumber: '', certificate: { file: null, preview: null, fileName: '' }, marksheet: { file: null, preview: null, fileName: '' } },
        superSpeciality: { degree: '', specialization: '', state: '', university: '', institute: '', yearOfGraduation: '', evaluationCriteria: '', obtainedScore: '', registrationNumber: '', certificate: { file: null, preview: null, fileName: '' }, marksheet: { file: null, preview: null, fileName: '' } },
        otherCertification: { courseName: '', specialization: '', state: '', university: '', institute: '', yearOfCourse: '', evaluationCriteria: '', obtainedScore: '', registrationNumber: '', certificate: { file: null, preview: null, fileName: '' }, marksheet: { file: null, preview: null, fileName: '' } },
        // EducationSection reads ``.length`` on every key here. Missing
        // keys (previously: institutes / pgSpecializations /
        // superSpecialitySpecializations) crashed the preview tab with
        // ``TypeError: Cannot read properties of undefined (reading
        // 'length')``. Keep this in sync with the redux slice's
        // ``dropdownOptions`` initial state in
        // ``doctorProfileEducationSlice.js``.
        dropdownOptions: {
            degrees: [],
            pgDegrees: [],
            superSpecialityDegrees: [],
            specializations: [],
            ugSpecializations: [],
            pgSpecializations: [],
            superSpecialitySpecializations: [],
            states: [],
            universities: [],
            pgUniversities: [],
            superSpecialityUniversities: [],
            institutes: [],
            pgInstitutes: [],
            superSpecialityInstitutes: [],
            evaluationCriteria: [],
        },
        isSubmitting: false,
    },
    bankDetailsState: {
        accounts: [
            {
                id: null, orderIndex: 0,
                bankName: 'State Bank of India', accountName: 'Dr. John Doe',
                accountNumber: '12345678901234', ifscCode: 'SBIN0001234', branch: 'Hyderabad Main Branch',
                passbook: { file: null, preview: null, fileName: '', fileUrl: null, verificationStatus: 'pending' },
                checkLeaf: { file: null, preview: null, fileName: '', fileUrl: null, verificationStatus: 'pending' },
                bankStatement: { file: null, preview: null, fileName: '', fileUrl: null, verificationStatus: 'pending' },
                verificationStatus: 'pending',
            },
            {
                id: null, orderIndex: 1,
                bankName: '', accountName: '', accountNumber: '', ifscCode: '', branch: '',
                passbook: { file: null, preview: null, fileName: '', fileUrl: null, verificationStatus: 'pending' },
                checkLeaf: { file: null, preview: null, fileName: '', fileUrl: null, verificationStatus: 'pending' },
                bankStatement: { file: null, preview: null, fileName: '', fileUrl: null, verificationStatus: 'pending' },
                verificationStatus: 'pending',
            },
        ],
        isSubmitting: false,
    },
    declarationState: {
        questions: [
            { configId: 'sample-q1', label: 'Have you ever been convicted of any criminal offense?', description: '', isRequired: true, hasExplanation: true, hasAttachment: true, answer: false, explanation: '', attachment: { file: null, preview: null, fileName: '', fileUrl: null } },
            { configId: 'sample-q2', label: 'Are you currently under any medical board investigation?', description: '', isRequired: true, hasExplanation: true, hasAttachment: false, answer: null, explanation: '', attachment: { file: null, preview: null, fileName: '', fileUrl: null } },
        ],
        documentTypes: [
            { configId: 'sample-d1', label: 'Medical License Copy', description: 'Upload a valid medical license', isRequired: true, file: { file: null, preview: null, fileName: '', fileUrl: null, verificationStatus: 'pending' } },
            { configId: 'sample-d2', label: 'Professional Indemnity Insurance', description: 'Upload insurance certificate', isRequired: false, file: { file: null, preview: null, fileName: '', fileUrl: null, verificationStatus: 'pending' } },
        ],
        selfDeclaration: { termsAccepted: false, policiesAccepted: false },
        isSubmitting: false,
    },
};

export default PREVIEW_SAMPLE_DATA;
