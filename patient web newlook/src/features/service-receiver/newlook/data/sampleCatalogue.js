/**
 * SAMPLE catalogue — the patient mobile MVP's own eight category catalogues,
 * copied verbatim from its ``src/data/mock.ts``.
 *
 * WHY THIS EXISTS, and the rule it follows:
 *
 * The real catalogue is ASSUMED endpoint #11 (GET /api/patient/product-categories),
 * which the backend doesn't implement. Without it every category page is an
 * empty shell, so none of the eight booking types can be clicked through or
 * demoed. This file fills that gap **for evaluation only**.
 *
 * It is never passed off as live data. A page falls back to it ONLY when the
 * real endpoint is genuinely missing, and whenever it does it says so on screen
 * (``isSample`` drives a visible "Sample data" banner + per-row chips). The
 * moment endpoint #11 answers, the API's own items win and this file goes
 * unused — delete it then.
 *
 * 88 items across the eight categories, ~11 per category, spanning all three
 * product kinds (appointment / service / group_service).
 */
export const SAMPLE_CATEGORY_ITEMS = {
    instant: [
            { id: 'ic1', name: 'Instant Video Consultation', short_name: 'Instant Video', kind: 'appointment', description: 'Connect to the next available doctor over video.', price: 600, meta: 'Avg wait 4 min' },
            { id: 'ic2', name: 'Instant Voice Consultation', short_name: 'Instant Voice', kind: 'appointment', description: 'A voice call with the next free doctor.', price: 400, meta: 'Avg wait 3 min' },
            { id: 'ic3', name: 'Instant Chat Consultation', short_name: 'Instant Chat', kind: 'appointment', description: 'Start messaging a doctor straight away.', price: 250, meta: 'Replies in ~5 min' },
            { id: 'ic4', name: 'Instant Paediatric Consult', short_name: 'Instant Paediatric', kind: 'appointment', description: 'Reach a paediatrician for your child within minutes.', price: 700, meta: 'Avg wait 6 min' },
            { id: 'ic5', name: 'Instant Second Opinion', short_name: 'Instant 2nd Opinion', kind: 'appointment', description: 'Upload a report and get a specialist read straight away.', price: 900, meta: 'Reply in ~15 min' },
            { id: 'ic6', name: 'Instant Gynaecology Consult', short_name: 'Instant Gynae', kind: 'appointment', description: 'Speak to a women’s health specialist now.', price: 800, meta: 'Avg wait 7 min' },
            { id: 'ic7', name: 'Instant Mental Health Support', short_name: 'Instant Mind', kind: 'appointment', description: 'Talk to a psychiatrist without an appointment.', price: 950, meta: 'Avg wait 8 min' },
            { id: 'ic8', name: 'Instant Dermatology Consult', short_name: 'Instant Derma', kind: 'appointment', description: 'Send a photo and speak to a skin specialist.', price: 650, meta: 'Avg wait 5 min' },
            { id: 'ic9', name: 'Instant Prescription Refill', short_name: 'Refill Request', kind: 'service', description: 'A doctor reviews and reissues an existing prescription.', price: 199, meta: 'Within 30 min' },
            { id: 'ic10', name: 'Instant Lab Report Review', short_name: 'Report Review', kind: 'service', description: 'A physician explains your latest results.', price: 399, meta: 'Within 1 hour' },
            { id: 'ic11', name: 'Instant Fever & Cold Consult', short_name: 'Instant Fever', kind: 'appointment', description: 'Same-minute advice for fever, cough and cold.', price: 350, meta: 'Avg wait 3 min' },
    ],
    online: [
            { id: 'oc1', name: 'Video Consultation', short_name: 'Video Consult', kind: 'appointment', description: 'Scheduled video call with chat and whiteboard.', price: 500, meta: 'Pick your slot' },
            { id: 'oc2', name: 'Voice Consultation', short_name: 'Voice Consult', kind: 'appointment', description: 'Audio-only call at a time that suits you.', price: 300, meta: 'Pick your slot' },
            { id: 'oc3', name: 'Chat Consultation', short_name: 'Chat Consult', kind: 'appointment', description: 'Message your doctor, reply within 24 hours.', price: 200, meta: 'Reply in 24 hrs' },
            { id: 'oc4', name: 'Scheduled Paediatric Video', short_name: 'Paediatric Video', kind: 'appointment', description: 'Book a video slot with a paediatrician.', price: 550, meta: 'Pick your slot' },
            { id: 'oc5', name: 'Cardiology Video Consultation', short_name: 'Cardiology Video', kind: 'appointment', description: 'Video review with a cardiologist, reports included.', price: 1100, meta: 'Pick your slot' },
            { id: 'oc6', name: 'Dermatology Video Consultation', short_name: 'Derma Video', kind: 'appointment', description: 'Skin and hair review over video.', price: 650, meta: 'Pick your slot' },
            { id: 'oc7', name: 'Endocrine Video Consultation', short_name: 'Endocrine Video', kind: 'appointment', description: 'Thyroid and diabetes review over video.', price: 700, meta: 'Pick your slot' },
            { id: 'oc8', name: 'Mental Health Video Session', short_name: 'Mind Video', kind: 'appointment', description: 'A 45-minute session with a psychiatrist.', price: 900, meta: '45 min slot' },
            { id: 'oc9', name: 'Nutrition Video Consultation', short_name: 'Nutrition Video', kind: 'appointment', description: 'Diet review with a clinical nutritionist.', price: 500, meta: 'Pick your slot' },
            { id: 'oc10', name: 'Follow-up Video Review', short_name: 'Follow-up Video', kind: 'appointment', description: 'A short review after an earlier consultation.', price: 300, meta: '15 min slot' },
            { id: 'oc11', name: 'Online Pre-Surgery Counselling', short_name: 'Pre-Surgery Chat', kind: 'service', description: 'Understand a planned procedure before you commit.', price: 799, meta: '40 min · video' },
    ],
    physical: [
            { id: 'pc1', name: 'Doctor Clinic Visit', short_name: 'Clinic Visit', kind: 'appointment', description: 'Visit your doctor at the clinic.', price: 700, meta: 'In clinic' },
            { id: 'pc2', name: 'Doctor Home Visit', short_name: 'Home Visit', kind: 'appointment', description: 'A doctor comes to your home.', price: 1200, meta: 'At home' },
            { id: 'pc3', name: 'Community Health Camp', short_name: 'Health Camp', kind: 'appointment', description: 'Reserve a place at an organised health camp.', price: 0, meta: 'Free · Camp' },
            { id: 'pc4', name: 'Home Sample Collection', short_name: 'Home Sample', kind: 'service', description: 'A phlebotomist collects samples at home.', price: 199, meta: 'Same day' },
            { id: 'pc5', name: 'Paediatric Clinic Visit', short_name: 'Paediatric Visit', kind: 'appointment', description: 'See a paediatrician in person at the clinic.', price: 600, meta: 'Book a slot' },
            { id: 'pc6', name: 'Cardiology Clinic Visit', short_name: 'Cardiology Visit', kind: 'appointment', description: 'In-person cardiac assessment with ECG.', price: 1200, meta: 'Book a slot' },
            { id: 'pc7', name: 'Orthopaedic Clinic Visit', short_name: 'Ortho Visit', kind: 'appointment', description: 'Joint and bone assessment in person.', price: 800, meta: 'Book a slot' },
            { id: 'pc8', name: 'Gynaecology Clinic Visit', short_name: 'Gynae Visit', kind: 'appointment', description: 'In-person women’s health consultation.', price: 750, meta: 'Book a slot' },
            { id: 'pc9', name: 'Home Doctor Visit — Elder Care', short_name: 'Home Elder Visit', kind: 'service', description: 'A physician visits an elderly family member at home.', price: 1500, meta: 'Same day' },
            { id: 'pc10', name: 'Home Physiotherapy Session', short_name: 'Home Physio', kind: 'service', description: 'A physiotherapist runs a session at your home.', price: 899, meta: 'Per session' },
            { id: 'pc11', name: 'In-Clinic Health Screening', short_name: 'Clinic Screening', kind: 'service', description: 'A guided screening visit with same-day results.', price: 2499, meta: '2 hours · 20 tests' },
    ],
    hybrid: [
            { id: 'hy1', name: 'Clinic Visit + Video Follow-ups', short_name: 'Clinic + Video', kind: 'service', description: 'First consult at the clinic, then two video follow-ups.', price: 1499, meta: '1 clinic · 2 video' },
            { id: 'hy2', name: 'Home Visit + Online Review', short_name: 'Home + Online', kind: 'service', description: 'A doctor visits you, then reviews progress online.', price: 1899, meta: '1 home · 1 video' },
            { id: 'hy3', name: 'Diagnostics + Online Report Review', short_name: 'Tests + Review', kind: 'service', description: 'Lab tests at a centre, results explained over video.', price: 2299, meta: 'Tests · 1 video' },
            { id: 'hy4', name: 'Hybrid Care Package – 30 Days', short_name: 'Hybrid Care (30d)', kind: 'group_service', description: 'A month of blended in-person and online care.', price: 6999, meta: '30 Days · 2 doctors' },
            { id: 'hy5', name: 'Diet & Nutrition Programme — 12 weeks', short_name: 'Diet Programme', kind: 'service', description: 'A nutritionist plans, reviews and adjusts your diet over 12 weeks. Message them any time.', price: 4999, meta: '12 weeks · chat included' },
            { id: 'hy6', name: 'Diabetes Group Coaching — 8 weeks', short_name: 'Diabetes Coaching', kind: 'group_service', description: 'Twice-weekly group sessions with an endocrinologist, nutritionist and fitness coach.', price: 7499, meta: '8 weeks · 3 providers' },
            { id: 'hy7', name: 'Surgery Consult + Online Follow-ups', short_name: 'Surgery Hybrid', kind: 'service', description: 'Surgical opinion in person, then two online reviews.', price: 2999, meta: '1 clinic · 2 video' },
            { id: 'hy8', name: 'Maternity Hybrid Package', short_name: 'Maternity Hybrid', kind: 'group_service', description: 'Clinic scans with online midwife support between visits.', price: 9999, meta: '9 months · team' },
            { id: 'hy9', name: 'Paediatric Growth Hybrid Plan', short_name: 'Child Growth Hybrid', kind: 'service', description: 'Quarterly clinic checks with online questions any time.', price: 3499, meta: '12 months' },
            { id: 'hy10', name: 'Cardiac Rehab Hybrid — 12 Weeks', short_name: 'Cardiac Rehab', kind: 'group_service', description: 'Supervised clinic sessions with remote monitoring.', price: 14999, meta: '12 weeks · 3 doctors' },
            { id: 'hy11', name: 'Mental Health Hybrid Programme', short_name: 'Mind Hybrid', kind: 'service', description: 'Alternating in-person and online therapy sessions.', price: 7999, meta: '8 weeks · chat' },
    ],
    recovery: [
            { id: 'rc1', name: 'Malaria Recovery Plan – 10 Days', short_name: 'Malaria Care (10d)', kind: 'service', description: 'Daily symptom checks through to clearance.', price: 2499, meta: '10 Days' },
            { id: 'rc2', name: 'Viral Fever Recovery Plan – 7 Days', short_name: 'Viral Fever Care (7d)', kind: 'service', description: 'Supportive care to recover safely at home.', price: 1299, meta: '7 Days' },
            { id: 'rc3', name: 'Dengue Recovery Plan – 10 Days', short_name: 'Dengue Care (10d)', kind: 'service', description: 'Platelet monitoring through the critical phase.', price: 3999, meta: '10 Days' },
            { id: 'rc4', name: 'Typhoid Recovery Plan – 14 Days', short_name: 'Typhoid Care (14d)', kind: 'service', description: 'Supervised antibiotic course with diet support.', price: 2999, meta: '14 Days' },
            { id: 'rc5', name: 'Post-COVID Recovery Plan – 21 Days', short_name: 'Post-COVID (21d)', kind: 'service', description: 'Breathing, stamina and fatigue monitoring after COVID.', price: 3299, meta: '21 Days' },
            { id: 'rc6', name: 'Post-Surgery Wound Care – 14 Days', short_name: 'Wound Care (14d)', kind: 'service', description: 'Daily wound review and dressing guidance.', price: 2799, meta: '14 Days' },
            { id: 'rc7', name: 'Chikungunya Recovery Plan – 14 Days', short_name: 'Chikungunya (14d)', kind: 'service', description: 'Joint-pain management through the recovery phase.', price: 2799, meta: '14 Days' },
            { id: 'rc8', name: 'Post-Dengue Strength Plan – 21 Days', short_name: 'Post-Dengue (21d)', kind: 'service', description: 'Rebuild strength and platelet counts after dengue.', price: 3499, meta: '21 Days' },
            { id: 'rc9', name: 'Jaundice Recovery Plan – 30 Days', short_name: 'Jaundice (30d)', kind: 'service', description: 'Liver function tracking with a supervised diet.', price: 4299, meta: '30 Days' },
            { id: 'rc10', name: 'Fracture Rehabilitation – 45 Days', short_name: 'Fracture Rehab (45d)', kind: 'service', description: 'Guided physiotherapy from cast removal to full use.', price: 5999, meta: '45 Days' },
            { id: 'rc11', name: 'Post-Delivery Recovery – 60 Days', short_name: 'Post-Delivery (60d)', kind: 'group_service', description: 'Mother and newborn support through the fourth trimester.', price: 8999, meta: '60 Days · team' },
    ],
    healthcare: [
            { id: 'hc1', name: 'Annual Preventive Health Plan – 12 Months', short_name: 'Annual Health (12m)', kind: 'group_service', description: 'Yearly full-body checks with a physician review.', price: 7999, meta: '12 Months · 2 doctors' },
            { id: 'hc2', name: 'Diabetes Management Plan – 6 Months', short_name: 'Diabetes Care (6m)', kind: 'group_service', description: 'Glucose tracking, diet and medication review.', price: 8999, meta: '6 Months · 3 doctors' },
            { id: 'hc3', name: 'Thyroid Care Plan – 3 Months', short_name: 'Thyroid Care (3m)', kind: 'group_service', description: 'Dose titration with periodic thyroid panels.', price: 4999, meta: '3 Months · 2 doctors' },
            { id: 'hc4', name: 'Full Body Health Checkup', short_name: 'Full Body Check', kind: 'service', description: '62 parameters including lipid, liver and kidney panels.', price: 2499, meta: 'Report in 24 hrs' },
            { id: 'hc5', name: 'Diabetes Preventive Plan – 12 Months', short_name: 'Diabetes Prevent', kind: 'service', description: 'Quarterly screening for anyone at risk of diabetes.', price: 7999, meta: '12 Months' },
            { id: 'hc6', name: 'Heart Health Screening – 6 Months', short_name: 'Heart Screening', kind: 'service', description: 'Lipids, ECG and echo with a cardiologist review.', price: 6499, meta: '6 Months' },
            { id: 'hc7', name: 'Women’s Wellness Plan – 12 Months', short_name: 'Women’s Wellness', kind: 'service', description: 'Screening and reviews built around women’s health.', price: 8999, meta: '12 Months' },
            { id: 'hc8', name: 'Child Immunisation Plan – 24 Months', short_name: 'Child Immunisation', kind: 'service', description: 'The full schedule tracked and reminded, visit by visit.', price: 5999, meta: '24 Months' },
            { id: 'hc9', name: 'Senior Citizen Care Plan – 12 Months', short_name: 'Senior Care', kind: 'group_service', description: 'Regular reviews and home visits for elderly parents.', price: 15999, meta: '12 Months · team' },
            { id: 'hc10', name: 'Corporate Executive Health – 12 Months', short_name: 'Executive Health', kind: 'service', description: 'A full annual work-up with a dedicated physician.', price: 19999, meta: '12 Months' },
            { id: 'hc11', name: 'Family Preventive Cover – 6 Months', short_name: 'Family Cover', kind: 'group_service', description: 'Preventive checks for up to four family members.', price: 8999, meta: '6 Months · 4 members' },
    ],
    advanced: [
            { id: 'ac1', name: 'Post-Kidney Surgery Recovery Plan – 30 Days', short_name: 'Post-Kidney Rehab (30d)', kind: 'group_service', description: 'Renal monitoring and diet support after surgery.', price: 18999, meta: '30 Days · 3 doctors' },
            { id: 'ac2', name: 'Post-Heart Surgery Recovery Plan – 45 Days', short_name: 'Post-Heart Rehab (45d)', kind: 'group_service', description: 'Surgeon-led recovery through cardiac rehab.', price: 29999, meta: '45 Days · 4 doctors' },
            { id: 'ac3', name: 'Post-Stroke Recovery Plan – 60 Days', short_name: 'Stroke Rehab (60d)', kind: 'group_service', description: 'Neurology, physiotherapy and speech therapy.', price: 34999, meta: '60 Days · 4 doctors' },
            { id: 'ac4', name: 'Chronic Heart Care Plan – 90 Days', short_name: 'Chronic Heart Care (90d)', kind: 'group_service', description: 'Long-term support for chronic cardiac conditions.', price: 24999, meta: '90 Days · 3 doctors' },
            { id: 'ac5', name: 'Post-Spinal Surgery Recovery – 60 Days', short_name: 'Spinal Recovery', kind: 'group_service', description: 'Neurosurgeon and physio team through spinal recovery.', price: 32999, meta: '60 Days · 3 doctors' },
            { id: 'ac6', name: 'Cancer Care Support Plan – 6 Months', short_name: 'Cancer Support', kind: 'group_service', description: 'Oncology, nutrition and counselling in one plan.', price: 49999, meta: '6 Months · 4 doctors' },
            { id: 'ac7', name: 'Stroke Rehabilitation – 90 Days', short_name: 'Stroke Rehab', kind: 'group_service', description: 'Neurology, physio and speech therapy after a stroke.', price: 38999, meta: '90 Days · 4 doctors' },
            { id: 'ac8', name: 'Chronic Kidney Care – 12 Months', short_name: 'CKD Care', kind: 'group_service', description: 'Nephrology-led management of chronic kidney disease.', price: 44999, meta: '12 Months · 3 doctors' },
            { id: 'ac9', name: 'COPD Management Plan – 12 Months', short_name: 'COPD Care', kind: 'group_service', description: 'Pulmonology team managing long-term lung disease.', price: 29999, meta: '12 Months · 3 doctors' },
            { id: 'ac10', name: 'Transplant Aftercare – 12 Months', short_name: 'Transplant Care', kind: 'group_service', description: 'Post-transplant monitoring and immunosuppression review.', price: 59999, meta: '12 Months · 4 doctors' },
            { id: 'ac11', name: 'Bariatric Surgery Support – 12 Months', short_name: 'Bariatric Support', kind: 'group_service', description: 'Surgery, nutrition and psychology through weight loss.', price: 39999, meta: '12 Months · 4 doctors' },
    ],
    longevity: [
            { id: 'lg1', name: 'Longevity & Healthy Ageing Plan – 12 Months', short_name: 'Healthy Ageing (12m)', kind: 'group_service', description: 'Whole-body ageing markers with quarterly reviews.', price: 39999, meta: '12 Months · 5 doctors' },
            { id: 'lg2', name: 'Metabolic Longevity Plan – 6 Months', short_name: 'Metabolic Longevity (6m)', kind: 'group_service', description: 'Metabolic health, body composition and nutrition.', price: 19999, meta: '6 Months · 3 doctors' },
            { id: 'lg3', name: 'Cardiac Longevity Plan – 12 Months', short_name: 'Cardiac Longevity (12m)', kind: 'group_service', description: 'Preventive cardiology with advanced lipid testing.', price: 27999, meta: '12 Months · 3 doctors' },
            { id: 'lg4', name: 'Cognitive Health Plan – 12 Months', short_name: 'Cognitive Health (12m)', kind: 'group_service', description: 'Memory, sleep and cognitive-function tracking.', price: 22999, meta: '12 Months · 3 doctors' },
            { id: 'lg5', name: 'Hormonal Longevity Plan – 12 Months', short_name: 'Hormonal Longevity', kind: 'group_service', description: 'Hormone panels and correction across the year.', price: 24999, meta: '12 Months · 3 doctors' },
            { id: 'lg6', name: 'Gut Health & Microbiome Plan – 6 Months', short_name: 'Gut Health', kind: 'group_service', description: 'Microbiome testing with a guided nutrition protocol.', price: 17999, meta: '6 Months · 3 doctors' },
            { id: 'lg7', name: 'Sleep Optimisation Plan – 6 Months', short_name: 'Sleep Plan', kind: 'group_service', description: 'Home sleep studies and a supervised correction plan.', price: 15999, meta: '6 Months · 2 doctors' },
            { id: 'lg8', name: 'Fitness & Body Composition – 12 Months', short_name: 'Body Composition', kind: 'group_service', description: 'DEXA-tracked strength and composition programme.', price: 21999, meta: '12 Months · 3 doctors' },
            { id: 'lg9', name: 'Immunity & Inflammation Plan – 12 Months', short_name: 'Immunity Plan', kind: 'group_service', description: 'Inflammatory markers tracked and brought down.', price: 23999, meta: '12 Months · 3 doctors' },
            { id: 'lg10', name: 'Skin & Hair Longevity Plan – 12 Months', short_name: 'Skin Longevity', kind: 'group_service', description: 'Dermatology-led ageing programme for skin and hair.', price: 18999, meta: '12 Months · 2 doctors' },
            { id: 'lg11', name: 'Executive Longevity Programme – 12 Months', short_name: 'Executive Longevity', kind: 'group_service', description: 'The full longevity work-up with a dedicated team.', price: 59999, meta: '12 Months · 5 doctors' },
    ],
};

/** The shape the assumed endpoint would return, for a drop-in fallback. */
export const sampleCategories = () =>
    Object.entries(SAMPLE_CATEGORY_ITEMS).map(([key, items]) => ({ key, items }));

/** Every sample item, flattened — for shelves that span categories. */
export const sampleAllItems = () =>
    Object.entries(SAMPLE_CATEGORY_ITEMS).flatMap(([key, items]) =>
        items.map((it) => ({ ...it, categoryKey: key })));
