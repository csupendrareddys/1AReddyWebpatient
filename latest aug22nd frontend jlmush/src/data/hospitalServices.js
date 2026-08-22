import {
  VideocamOutlined,
  SearchOutlined,
  CalendarMonthOutlined,
  LocalPharmacyOutlined,
  BiotechOutlined,
  VaccinesOutlined,
  ChatOutlined,
  HeadsetMicOutlined,
  PersonSearchOutlined,
  MedicalServicesOutlined,
  HomeOutlined,
  EventRepeatOutlined,
  HealthAndSafetyOutlined,
  PsychologyOutlined,
  FitnessCenterOutlined,
  RestaurantOutlined,
} from '@mui/icons-material';

// --- Mega Menu Categories ---
export const PRODUCT_CATEGORIES = {
  Consultations: [
    { name: 'Video Consultation', icon: VideocamOutlined },
    { name: 'Audio Consultation', icon: HeadsetMicOutlined },
    { name: 'Chat Consultation', icon: ChatOutlined },
    { name: 'Instant Consultation', icon: MedicalServicesOutlined },
  ],
  Doctors: [
    { name: 'Find Specialists', icon: PersonSearchOutlined },
    { name: 'Find General Physicians', icon: SearchOutlined },
    { name: 'Find Surgeons', icon: SearchOutlined },
    { name: 'Find Dentists', icon: SearchOutlined },
    { name: 'Find Dermatologists', icon: SearchOutlined },
  ],
  Appointments: [
    { name: 'Online Appointment', icon: CalendarMonthOutlined },
    { name: 'In-Person Visit', icon: CalendarMonthOutlined },
    { name: 'Home Visit', icon: HomeOutlined },
    { name: 'Follow-up', icon: EventRepeatOutlined },
  ],
  Pharmacy: [
    { name: 'Order Medicines', icon: LocalPharmacyOutlined },
    { name: 'Health Products', icon: HealthAndSafetyOutlined },
    { name: 'Lab Tests', icon: BiotechOutlined },
    { name: 'Vaccinations', icon: VaccinesOutlined },
  ],
  Wellness: [
    { name: 'Counseling', icon: PsychologyOutlined },
    { name: 'Nutrition', icon: RestaurantOutlined },
    { name: 'Fitness', icon: FitnessCenterOutlined },
    { name: 'Mental Health', icon: PsychologyOutlined },
  ],
};

// --- Browse-by-Category cards on landing page ---
export const HOME_CATEGORIES = [
  { id: 'Consultations', label: 'Consultations', icon: VideocamOutlined, color: '#2196F3' },
  { id: 'Doctors', label: 'Doctors', icon: PersonSearchOutlined, color: '#4CAF50' },
  { id: 'Appointments', label: 'Appointments', icon: CalendarMonthOutlined, color: '#E8833A' },
  { id: 'Pharmacy', label: 'Pharmacy', icon: LocalPharmacyOutlined, color: '#9C27B0' },
  { id: 'Wellness', label: 'Wellness', icon: PsychologyOutlined, color: '#00BCD4' },
  { id: 'Lab Tests', label: 'Lab Tests', icon: BiotechOutlined, color: '#FF5722' },
  { id: 'Vaccinations', label: 'Vaccinations', icon: VaccinesOutlined, color: '#3F51B5' },
  { id: 'Home Visit', label: 'Home Visit', icon: HomeOutlined, color: '#009688' },
];

// --- Popular Services for the grid ---
export const HOSPITAL_SERVICES = [
  {
    id: 1,
    title: 'Video Consultation',
    desc: 'Consult top doctors via HD video call from anywhere',
    icon: VideocamOutlined,
    color: '#2196F3',
    price: 'From \u20B9299',
    tags: ['video', 'online', 'consultation'],
  },
  {
    id: 2,
    title: 'Find Doctors',
    desc: 'Search and connect with verified specialists near you',
    icon: SearchOutlined,
    color: '#4CAF50',
    price: 'Free',
    tags: ['doctors', 'specialists', 'search'],
  },
  {
    id: 3,
    title: 'Book Appointment',
    desc: 'Schedule in-person or online appointments instantly',
    icon: CalendarMonthOutlined,
    color: '#E8833A',
    price: 'From \u20B9199',
    tags: ['appointment', 'booking', 'schedule'],
  },
  {
    id: 4,
    title: 'Pharmacy',
    desc: 'Order medicines and health products with fast delivery',
    icon: LocalPharmacyOutlined,
    color: '#9C27B0',
    price: 'Varies',
    tags: ['pharmacy', 'medicines', 'delivery'],
  },
  {
    id: 5,
    title: 'Lab Tests',
    desc: 'Book diagnostic tests with home sample collection',
    icon: BiotechOutlined,
    color: '#00BCD4',
    price: 'From \u20B9149',
    tags: ['lab', 'tests', 'diagnostics'],
  },
  {
    id: 6,
    title: 'Vaccinations',
    desc: 'Get vaccinated at verified clinics near you',
    icon: VaccinesOutlined,
    color: '#FF5722',
    price: 'From \u20B999',
    tags: ['vaccine', 'immunization'],
  },
];

// --- Service Detail Data (for ServiceDetailPage) ---
export const SERVICE_DETAILS = {
  'Video Consultation': {
    title: 'Video Consultation',
    description: 'Connect with top doctors face-to-face via secure HD video calls. Get diagnosed, receive prescriptions, and follow up \u2014 all without leaving home.',
    price: '\u20B9299',
    timeline: '15-30 min',
    whatIs: 'Video consultation allows you to see a doctor from the comfort of your home using a secure, HIPAA-compliant video platform. Discuss your symptoms, get a diagnosis, and receive a digital prescription instantly.',
    requirements: [
      'A smartphone or computer with a camera',
      'Stable internet connection',
      'Valid government ID for verification',
      'Previous medical reports (if any)',
    ],
    process: [
      { title: 'Choose a Doctor', desc: 'Browse specialists or let us match you with the right doctor.' },
      { title: 'Book a Slot', desc: 'Select a convenient date and time for your consultation.' },
      { title: 'Join Video Call', desc: 'Connect with the doctor via our secure HD video platform.' },
      { title: 'Get Prescription', desc: 'Receive a digital prescription and follow-up instructions.' },
    ],
    pros: [
      'Consult from anywhere without travel',
      'Shorter wait times compared to in-person visits',
      'Access to specialists across the country',
      'Digital prescriptions delivered instantly',
      'Secure and private HIPAA-compliant platform',
    ],
    cons: [
      'Not suitable for emergencies requiring physical examination',
      'Requires stable internet connectivity',
      'Some conditions may need in-person follow-up',
    ],
    documents: ['Government ID (Aadhar/PAN)', 'Previous medical reports', 'Insurance card (optional)'],
  },
  'Find Doctors': {
    title: 'Find Doctors',
    description: 'Search our extensive network of verified healthcare professionals. Filter by specialty, location, experience, and patient ratings.',
    price: 'Free',
    timeline: 'Instant',
    whatIs: 'Our doctor search platform connects you with thousands of verified doctors across multiple specialties. Each doctor is vetted for qualifications, experience, and patient reviews.',
    requirements: [
      'Create a free account',
      'Enable location for nearby results',
    ],
    process: [
      { title: 'Search', desc: 'Enter your symptoms or specialty to find matching doctors.' },
      { title: 'Filter & Compare', desc: 'Filter by location, rating, experience, and fees.' },
      { title: 'View Profiles', desc: 'Check qualifications, reviews, and availability.' },
      { title: 'Book or Consult', desc: 'Schedule an appointment or start an instant consultation.' },
    ],
    pros: [
      'Access to thousands of verified doctors',
      'Detailed profiles with reviews and ratings',
      'Filter by specialty, location, and fees',
      'Compare multiple doctors side by side',
    ],
    cons: [
      'Availability may vary by location',
      'Top-rated doctors may have longer wait times',
    ],
    documents: [],
  },
  'Book Appointment': {
    title: 'Book Appointment',
    description: 'Schedule in-person or online appointments with verified doctors. Choose your preferred time slot and get instant confirmation.',
    price: 'From \u20B9199',
    timeline: 'Instant booking',
    whatIs: 'Our appointment booking system lets you schedule visits with doctors at your convenience. Choose between in-person clinic visits, video consultations, or home visits.',
    requirements: [
      'Registered account on JLMush',
      'Valid contact number',
      'Basic health information',
    ],
    process: [
      { title: 'Select Doctor', desc: 'Choose from our network of verified healthcare professionals.' },
      { title: 'Pick Time Slot', desc: 'Select a date and time that works for you.' },
      { title: 'Confirm Booking', desc: 'Review details and confirm your appointment.' },
      { title: 'Visit or Join', desc: 'Visit the clinic or join the online session at the scheduled time.' },
    ],
    pros: [
      'Instant booking confirmation',
      'Flexible scheduling with multiple time slots',
      'Easy rescheduling and cancellation',
      'Reminders via SMS and email',
    ],
    cons: [
      'Peak hours may have limited availability',
      'Cancellation fees may apply for late cancellations',
    ],
    documents: ['Government ID', 'Insurance card (if applicable)', 'Previous prescriptions'],
  },
  Pharmacy: {
    title: 'Online Pharmacy',
    description: 'Order prescription medicines and health products online with doorstep delivery. Upload your prescription and get medicines delivered fast.',
    price: 'Varies',
    timeline: '1-2 days delivery',
    whatIs: 'Our online pharmacy lets you order medicines using digital or uploaded prescriptions. We partner with verified pharmacies to ensure genuine medicines at competitive prices.',
    requirements: [
      'Valid prescription for prescription medicines',
      'Delivery address',
      'Payment method',
    ],
    process: [
      { title: 'Upload Prescription', desc: 'Upload your prescription or use a digital one from your consultation.' },
      { title: 'Add to Cart', desc: 'Select medicines and health products to add to your cart.' },
      { title: 'Place Order', desc: 'Review your order and complete the payment.' },
      { title: 'Doorstep Delivery', desc: 'Receive your medicines at your doorstep within 1-2 days.' },
    ],
    pros: [
      'Genuine medicines from verified pharmacies',
      'Competitive pricing with discounts',
      'Fast doorstep delivery',
      'Easy prescription upload',
    ],
    cons: [
      'Delivery time may vary by location',
      'Some medicines may require original physical prescription',
    ],
    documents: ['Prescription (digital or physical)', 'Delivery address proof'],
  },
  'Lab Tests': {
    title: 'Lab Tests & Diagnostics',
    description: 'Book diagnostic tests with home sample collection. Get accurate results from NABL-accredited labs delivered digitally.',
    price: 'From \u20B9149',
    timeline: '24-48 hours for reports',
    whatIs: 'Our diagnostic services connect you with NABL-accredited laboratories. Book tests online, get home sample collection, and receive digital reports.',
    requirements: [
      'Doctor prescription (for some tests)',
      'Fasting requirements (if applicable)',
      'Valid contact details',
    ],
    process: [
      { title: 'Select Tests', desc: 'Browse available tests or use your doctor\'s recommendation.' },
      { title: 'Book Collection', desc: 'Schedule a home sample collection at your convenience.' },
      { title: 'Sample Collected', desc: 'A trained phlebotomist collects your sample at home.' },
      { title: 'Get Reports', desc: 'Receive digital reports within 24-48 hours.' },
    ],
    pros: [
      'Home sample collection available',
      'NABL-accredited labs ensure accuracy',
      'Digital reports accessible anytime',
      'Competitive pricing with package deals',
    ],
    cons: [
      'Some specialized tests may not support home collection',
      'Report timing varies by test complexity',
    ],
    documents: ['Doctor prescription (if required)', 'Previous test reports (for comparison)'],
  },
  Vaccinations: {
    title: 'Vaccinations',
    description: 'Get vaccinated at verified clinics near you. We offer a wide range of vaccines for children, adults, and travelers.',
    price: 'From \u20B999',
    timeline: 'Same day',
    whatIs: 'Our vaccination service connects you with verified clinics offering a comprehensive range of vaccines. From routine immunizations to travel vaccines, we ensure safe and proper vaccination.',
    requirements: [
      'Age-appropriate eligibility',
      'Previous vaccination records',
      'Valid ID proof',
    ],
    process: [
      { title: 'Select Vaccine', desc: 'Choose the vaccination you need from our catalog.' },
      { title: 'Find Clinic', desc: 'Locate a verified vaccination center near you.' },
      { title: 'Book Slot', desc: 'Reserve your vaccination appointment.' },
      { title: 'Get Vaccinated', desc: 'Visit the clinic and receive your vaccination with a digital certificate.' },
    ],
    pros: [
      'Wide range of vaccines available',
      'Verified clinics with trained professionals',
      'Digital vaccination certificates',
      'Reminders for booster doses',
    ],
    cons: [
      'Some vaccines may have limited stock',
      'Not all vaccines available at all locations',
    ],
    documents: ['ID proof', 'Previous vaccination records', 'Doctor recommendation (for special vaccines)'],
  },
};

// --- Platform Stats ---
export const STATS = [
  { value: '10,000+', label: 'Happy Patients' },
  { value: '500+', label: 'Verified Doctors' },
  { value: '50+', label: 'Specialties' },
  { value: '20+', label: 'Cities' },
];

// --- Testimonials ---
export const TESTIMONIALS = [
  {
    quote: 'The video consultation was seamless. I got my prescription within 15 minutes without leaving home!',
    name: 'Priya Sharma',
    role: 'Patient',
  },
  {
    quote: 'Finding a specialist was so easy. The doctor profiles with ratings helped me make the right choice.',
    name: 'Rahul Verma',
    role: 'Patient',
  },
  {
    quote: 'Ordering medicines online saved me so much time. Delivery was fast and the medicines were genuine.',
    name: 'Anjali Patel',
    role: 'Patient',
  },
];

// --- FAQs ---
export const FAQS = [
  {
    question: 'How do I book a video consultation?',
    answer: 'Simply sign up, browse our doctors, select a specialist, and book a time slot. You will receive a link to join the video call at the scheduled time.',
  },
  {
    question: 'Are the doctors verified?',
    answer: 'Yes, all doctors on our platform are verified for their qualifications, medical registration, and experience before they can offer consultations.',
  },
  {
    question: 'Can I get a prescription through online consultation?',
    answer: 'Yes, doctors can issue digital prescriptions after a video or audio consultation. These are valid at any pharmacy.',
  },
  {
    question: 'How is my medical data protected?',
    answer: 'We use industry-standard encryption and follow HIPAA guidelines to ensure your health data remains private and secure.',
  },
  {
    question: 'What if I need to cancel or reschedule?',
    answer: 'You can cancel or reschedule your appointment up to 2 hours before the scheduled time without any charges.',
  },
];
