"""
Prescription PDF generation service.
Generates a professional E-Prescription PDF from a Prescription record
and uploads to S3 private bucket. Returns a bucket::key reference
for presigned URL generation on each request.
"""
import io
import logging
import os
import tempfile
import urllib.request
import uuid
from datetime import datetime, date, timezone

from fpdf import FPDF
from flask import current_app

from app.services.s3_service import S3Service

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────

def _download_image(url):
    """Download an image from URL to a temp file. Returns path or None."""
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'PrescriptionPDF/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            suffix = '.png'
            if 'jpeg' in (resp.headers.get('Content-Type') or ''):
                suffix = '.jpg'
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            tmp.write(resp.read())
            tmp.close()
            return tmp.name
    except Exception as e:
        logger.warning(f'Failed to download image: {e}')
        return None


def _cleanup_temp(path):
    if path:
        try:
            os.unlink(path)
        except Exception:
            pass


def _calc_age(dob):
    """Return age in years from a date object."""
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _get_qualification_str(doc):
    """Build qualification string from doctor's qualifications relationship."""
    try:
        quals = list(doc.qualifications.all()) if hasattr(doc.qualifications, 'all') else []
        if quals:
            return ', '.join(q.degree_name for q in quals if q.degree_name)
    except Exception:
        pass
    return None


def _get_specialization_str(doc):
    """Build specialization string from doctor's specializations relationship."""
    try:
        specs = list(doc.specializations.all()) if hasattr(doc.specializations, 'all') else []
        if specs:
            return ', '.join(s.category.name for s in specs if s.category and s.category.name)
    except Exception:
        pass
    return None


def _get_clinic_address(doc):
    """Build clinic address from communication_address JSON field."""
    comm_addr = getattr(doc, 'communication_address', None)
    if comm_addr and isinstance(comm_addr, dict):
        parts = [
            comm_addr.get('address_line1', ''),
            comm_addr.get('address_line2', ''),
            comm_addr.get('city', ''),
            comm_addr.get('state', ''),
            comm_addr.get('pincode', ''),
        ]
        addr = ', '.join(p for p in parts if p)
        return addr or None
    return None


def _get_signature_image(doc):
    """
    Download the best available signature image.
    Priority: digital > signature1 > signature2
    Returns (temp_file_path, is_digital_signature) or (None, False).
    """
    sig_record = getattr(doc, 'signature_record', None)
    if not sig_record:
        return None, False

    # Priority order
    candidates = [
        (sig_record.digital_signature_s3_key, sig_record.digital_signature_s3_bucket, True),
        (sig_record.signature1_s3_key, sig_record.signature1_s3_bucket, False),
        (sig_record.signature2_s3_key, sig_record.signature2_s3_bucket, False),
    ]
    for s3_key, s3_bucket, is_digital in candidates:
        if s3_key and s3_bucket:
            try:
                sig_url = S3Service.generate_presigned_url(s3_bucket, s3_key, 300)
                path = _download_image(sig_url)
                if path:
                    return path, is_digital
            except Exception:
                continue
    return None, False


# ──────────────────────────────────────────────────────────────────
# Custom PDF class
# ──────────────────────────────────────────────────────────────────

class PrescriptionPDF(FPDF):
    """Custom FPDF class for prescription layout."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.set_auto_page_break(auto=True, margin=20)


# ──────────────────────────────────────────────────────────────────
# Main PDF generation
# ──────────────────────────────────────────────────────────────────

def generate_prescription_pdf(prescription, template=None, disclaimer=None, disclaimer_title=None):
    """
    Generate a PDF for the given Prescription ORM object.

    Changes from previous version:
    - Stamp-style digital signature: "Digitally signed by Dr [name]" + date/time
    - Signature priority: digital > image > text
    - Patient info box: Name, Age, Gender, Contact Number, Patient ID (Aadhar)
    - Renamed "Notes" -> "Chief Complaint"
    - Added "Previous Medical History" section
    - Added Rx symbol before medicines
    - Doctor qualification in header
    - Clinic address in header
    - E-prescription validity line

    Args:
        prescription: Prescription model instance (with relationships loaded).
            Also accepts a DoctorDocument — it mirrors the same attributes.
        template: PrescriptionTemplate model instance (optional)
        disclaimer / disclaimer_title: override the template's disclaimer.
            Documents pass their own so they don't print prescription-only
            wording ("teleconsultation", "not valid for medico-legal purpose").

    Returns:
        'bucket::key' string for presigned URL generation, or None on failure.
    """
    try:
        p = prescription
        doc = p.doctor
        patient = p.patient
        tpl = template

        pdf = PrescriptionPDF('P', 'mm', 'A4')
        pdf.add_page()

        # ─── HEADER ─────────────────────────────────────────────
        pdf.set_fill_color(232, 245, 233)  # light green
        pdf.rect(10, 10, 190, 32, 'F')

        # Clinic name + address (left side)
        clinic_name = getattr(tpl, 'clinic_name', None) or ''
        clinic_address = _get_clinic_address(doc) if doc else None

        left_y = 14
        if clinic_name:
            pdf.set_xy(15, left_y)
            pdf.set_font('Helvetica', 'B', 14)
            pdf.cell(90, 8, clinic_name)
            left_y += 8

        if clinic_address:
            pdf.set_xy(15, left_y)
            pdf.set_font('Helvetica', '', 7)
            # Wrap address if too long
            pdf.multi_cell(90, 3.5, clinic_address)
            left_y = pdf.get_y()

        # Doctor info (right side)
        if doc:
            right_y = 14
            pdf.set_font('Helvetica', 'B', 11)
            pdf.set_xy(120, right_y)
            pdf.cell(75, 5, f'Dr. {doc.full_name}', align='R')
            right_y += 5

            pdf.set_font('Helvetica', '', 9)
            qual_str = getattr(p, 'doctor_qualification_snapshot', None) or _get_qualification_str(doc)
            if qual_str:
                pdf.set_xy(120, right_y)
                pdf.cell(75, 4, qual_str, align='R')
                right_y += 4

            spec_str = getattr(p, 'doctor_specialization_snapshot', None) or _get_specialization_str(doc)
            if spec_str:
                pdf.set_xy(120, right_y)
                pdf.cell(75, 4, spec_str, align='R')
                right_y += 4

            reg = getattr(doc, 'registration_number', None)
            if reg:
                pdf.set_xy(120, right_y)
                pdf.cell(75, 4, f'Reg No: {reg}', align='R')

        # ─── PATIENT INFO BOX ───────────────────────────────────
        patient_box_y = 46
        pdf.set_fill_color(241, 248, 233)

        # ``dob`` and ``gender`` were moved from Patient → User by
        # the schema split. Read them off ``patient.user`` (the
        # column doesn't exist on Patient anymore — would AttributeError).
        patient_name = patient.full_name if patient else 'Patient'
        _u = patient.user if patient else None
        age = _calc_age(_u.dob) if _u and _u.dob else None
        gender_str = _u.gender.value.capitalize() if _u and _u.gender else ''
        phone = _u.phone_number if _u else None
        patient_id = patient.aadhar_number if patient else None

        # Fetch latest vitals from health_records
        patient_height = None
        patient_weight = None
        if patient:
            try:
                from app.models import HealthRecord
                vr = HealthRecord.query.filter_by(
                    patient_id=patient.id, record_type='vitals', is_deleted=False
                ).order_by(HealthRecord.record_date.desc()).first()
                if vr and vr.details:
                    h = vr.details.get('height_cm')
                    w = vr.details.get('weight_kg')
                    patient_height = float(h) if h else None
                    patient_weight = float(w) if w else None
            except Exception:
                pass

        # Determine box height based on whether height/weight exist
        has_hw = patient_height or patient_weight
        box_height = 28 if has_hw else 22
        pdf.rect(10, patient_box_y, 190, box_height, 'F')

        # Left column — Name
        pdf.set_xy(12, patient_box_y + 2)
        pdf.set_font('Helvetica', 'B', 10)
        pdf.cell(90, 5, f'Patient: {patient_name}')

        # Age / Gender
        info_parts = []
        if age is not None:
            info_parts.append(f'Age: {age} Yrs')
        if gender_str:
            info_parts.append(gender_str)

        pdf.set_font('Helvetica', '', 9)
        pdf.set_xy(12, patient_box_y + 8)
        pdf.cell(90, 4, '  |  '.join(info_parts))

        # Height / Weight
        hw_parts = []
        if patient_height:
            hw_parts.append(f'Height: {patient_height:.1f} cm')
        if patient_weight:
            hw_parts.append(f'Weight: {patient_weight:.1f} kg')

        row_offset = 13
        if hw_parts:
            pdf.set_xy(12, patient_box_y + row_offset)
            pdf.set_font('Helvetica', '', 8)
            pdf.cell(110, 4, '  |  '.join(hw_parts))
            row_offset += 5

        # Contact & Patient ID
        row2_parts = []
        if phone:
            row2_parts.append(f'Contact: {phone}')
        if patient_id:
            # Mask aadhar: show last 4 digits only
            masked = 'XXXX-XXXX-' + patient_id[-4:] if len(patient_id) >= 4 else patient_id
            row2_parts.append(f'ID: {masked}')

        if row2_parts:
            pdf.set_xy(12, patient_box_y + row_offset)
            pdf.set_font('Helvetica', '', 8)
            pdf.cell(110, 4, '  |  '.join(row2_parts))

        # Right column — Date & Prescription ID
        pdf.set_font('Helvetica', '', 9)
        date_str = p.issue_date.strftime('%d %B %Y') if p.issue_date else ''
        pdf.set_xy(120, patient_box_y + 3)
        pdf.cell(75, 5, date_str, align='R')

        rx_id = str(p.id)[:8].upper()
        pdf.set_xy(120, patient_box_y + 9)
        pdf.set_font('Helvetica', '', 8)
        pdf.cell(75, 4, f'Prescription ID: {rx_id}', align='R')

        # ─── BODY SECTIONS ──────────────────────────────────────
        y = patient_box_y + box_height + 4

        # Build label lookup from template sections_config (admin-configurable)
        DEFAULT_LABELS = {
            'notes': 'Chief Complaint',
            'previous_medical_history': 'Previous Medical History',
            'allergies': 'Allergies',
            'diagnosis': 'Provisional Diagnosis',
            'diagnostic_tests': 'Diagnostic Tests',
            'instructions': 'Instructions',
            'medicines': 'Medicines',
            'doctors_advice': "Doctor's Advice",
            'follow_up': 'Follow-up',
        }
        tpl_sections = getattr(tpl, 'sections_config', None) or []
        label_map = dict(DEFAULT_LABELS)  # start with defaults
        visibility_map = {k: True for k in DEFAULT_LABELS}
        for sec in tpl_sections:
            key = sec.get('key', '')
            if key in label_map:
                if sec.get('label'):
                    label_map[key] = sec['label']
                visibility_map[key] = sec.get('visible', True)

        def sec_label(key):
            return label_map.get(key, DEFAULT_LABELS.get(key, key))

        def sec_visible(key):
            return visibility_map.get(key, True)

        # Sections rendered in order (driven by template order if available)
        section_keys_ordered = [
            'notes', 'previous_medical_history', 'allergies',
            'diagnosis', 'diagnostic_tests', 'instructions',
        ]
        # Use template order if present
        if tpl_sections:
            ordered = sorted(tpl_sections, key=lambda s: s.get('order', 99))
            template_keys = [s['key'] for s in ordered if s['key'] in section_keys_ordered]
            remaining = [k for k in section_keys_ordered if k not in template_keys]
            section_keys_ordered = template_keys + remaining

        def render_block(heading, content):
            """Emit one 'bold heading + wrapped body' section, paging as needed."""
            nonlocal y
            if y > 260:
                pdf.add_page()
                y = 15
            pdf.set_xy(12, y)
            pdf.set_font('Helvetica', 'B', 10)
            pdf.cell(0, 6, heading)
            y += 7
            pdf.set_xy(12, y)
            pdf.set_font('Helvetica', '', 9)
            pdf.multi_cell(186, 5, content)
            y = pdf.get_y() + 3

        # Documents (DoctorDocument) carry no fixed clinical columns — their
        # content is ``description`` plus doctor-named ``custom_fields``.
        # Prescriptions have neither attribute, so both blocks no-op there
        # and the fixed-section loop below does the work instead.
        description = getattr(p, 'description', None)
        if description:
            render_block('Description', description)

        # Documents serialise their fields through to_dict, but this renderer
        # gets the ORM object, so fold the attachments in the same way.
        _field_atts = {}
        if hasattr(p, 'field_attachments'):
            try:
                for att in p.field_attachments.all():
                    _field_atts.setdefault(str(att.field_id), []).append(att.file_name or 'file')
            except Exception:
                _field_atts = {}

        for custom in (getattr(p, 'custom_fields', None) or []):
            label = (custom.get('label') or '').strip()
            value = (custom.get('value') or '').strip()
            if not label:
                continue
            names = _field_atts.get(str(custom.get('id')), [])
            body = value or '-'
            # Names only — a PDF can't carry the presigned URLs, they expire.
            if names:
                body += '\nAttached: ' + ', '.join(names)
            render_block(label, body)

        for field in section_keys_ordered:
            if not sec_visible(field):
                continue
            content = getattr(p, field, None)
            if not content:
                continue
            render_block(sec_label(field), content)

        # ─── MEDICINES TABLE with Rx symbol ─────────────────────
        # ``getattr`` not ``p.medicines`` — DoctorDocument has no medicines
        # relationship at all, and this renderer is shared with it.
        _meds = getattr(p, 'medicines', None)
        medicines = list(_meds.all()) if hasattr(_meds, 'all') else (_meds or [])
        # Filter out content-empty rows (no catalog medicine, no
        # custom name, no dosage, no M/A/E/N) — defence for any
        # historical prescriptions that landed before the backend
        # save-time empty-row skip in routes.py was added. Without
        # this filter the PDF still shows a row of dashes for those.
        def _has_content(m):
            if getattr(m, 'medicine_id', None):
                return True
            for attr in (
                'custom_generic_name', 'custom_brand_name',
                'dosage', 'frequency', 'duration',
                'morning', 'afternoon', 'evening', 'night',
                'special_instructions',
            ):
                v = getattr(m, attr, None)
                if v is not None and (not isinstance(v, str) or v.strip()):
                    return True
            return False
        medicines = [m for m in medicines if _has_content(m)]
        if medicines and sec_visible('medicines'):
            if y > 225:
                pdf.add_page()
                y = 15

            # Rx symbol — use admin-uploaded image if available, else fallback to text
            rx_img_url = getattr(tpl, 'rx_symbol_url', None) if tpl else None
            rx_img_path = None
            if rx_img_url:
                rx_img_path = _download_image(rx_img_url)

            rx_sym_w = 12  # width reserved for the Rx area
            if rx_img_path:
                try:
                    pdf.image(rx_img_path, x=12, y=y, w=rx_sym_w, h=9)
                except Exception:
                    rx_img_path = None
                finally:
                    _cleanup_temp(rx_img_path)

            if not rx_img_path:
                # Fallback: admin text (e.g. "℞") or default "Rx"
                rx_text = getattr(tpl, 'rx_symbol_text', None) if tpl else None
                rx_fallback = rx_text or 'Rx'
                pdf.set_xy(12, y)
                pdf.set_font('Helvetica', 'B', 16)
                pdf.cell(rx_sym_w, 8, rx_fallback, align='L')

            pdf.set_font('Helvetica', 'B', 10)
            pdf.set_xy(12 + rx_sym_w + 2, y + 1)
            pdf.cell(0, 6, sec_label('medicines'))
            y += 10

            # Table header
            col_w = [10, 52, 22, 22, 22, 22, 22, 22]
            headers = ['#', 'Medicine', 'Type', 'M', 'A', 'E', 'N', 'Duration']
            pdf.set_fill_color(232, 245, 233)
            pdf.set_font('Helvetica', 'B', 8)
            pdf.set_xy(10, y)
            for i, h in enumerate(headers):
                pdf.cell(col_w[i], 6, h, border=1, fill=True, align='C')
            y += 6

            pdf.set_font('Helvetica', '', 8)
            for idx, m in enumerate(medicines):
                if y > 270:
                    pdf.add_page()
                    y = 15
                pdf.set_xy(10, y)
                med_name = getattr(m, 'generic_name', '') or getattr(m, 'custom_generic_name', '') or ''
                brand = getattr(m, 'brand_name', '') or getattr(m, 'custom_brand_name', '') or ''
                display_name = med_name
                if brand and brand.lower() != med_name.lower():
                    display_name = f'{med_name} ({brand})'

                med_type = getattr(m, 'medicine_type', 'solid') or 'solid'
                unit = ' ml' if med_type == 'liquid' else ' g' if med_type == 'powder' else (
                    f' {getattr(m, "custom_dose_unit", "") or ""}' if med_type == 'other' else '')

                def fmt_slot(val, timing=None):
                    if not val:
                        return '-'
                    s = f'{val}{unit}'
                    if timing:
                        s += f' ({timing})'
                    return s

                row = [
                    str(getattr(m, 'serial_no', idx + 1)),
                    display_name[:28],
                    med_type,
                    fmt_slot(m.morning, getattr(m, 'morning_timing', None)),
                    fmt_slot(m.afternoon, getattr(m, 'afternoon_timing', None)),
                    fmt_slot(m.evening, getattr(m, 'evening_timing', None)),
                    fmt_slot(m.night, getattr(m, 'night_timing', None)),
                    getattr(m, 'duration', '') or '-',
                ]
                for i, val in enumerate(row):
                    pdf.cell(col_w[i], 6, str(val)[:18], border=1, align='C')
                y += 6

            y += 4

        # ─── Doctor's Advice ────────────────────────────────────
        if getattr(p, 'doctors_advice', None) and sec_visible('doctors_advice'):
            if y > 260:
                pdf.add_page()
                y = 15
            pdf.set_xy(12, y)
            pdf.set_font('Helvetica', 'B', 10)
            pdf.cell(0, 6, sec_label('doctors_advice'))
            y += 7
            pdf.set_xy(12, y)
            pdf.set_font('Helvetica', '', 9)
            pdf.multi_cell(186, 5, getattr(p, 'doctors_advice', '') or '')
            y = pdf.get_y() + 3

        # ─── Follow-up Section ──────────────────────────────────
        follow_up_text = getattr(p, 'follow_up', None) or ''
        follow_up_type = getattr(p, 'follow_up_type', None)

        if follow_up_type:
            fu_ct = getattr(p, 'follow_up_consultation_type', None)
            fu_date = getattr(p, 'follow_up_date', None)
            fu_slot = getattr(p, 'follow_up_time_slot', None)
            ct_label = fu_ct.value.replace('_', ' ').title() if fu_ct else ''
            type_val = follow_up_type.value

            parts = []
            if type_val == 'free_doctor':
                parts.append('Free follow-up consultation scheduled')
            elif type_val == 'paid_patient_picks':
                parts.append('Paid follow-up consultation recommended')
            elif type_val == 'paid_doctor_picks':
                parts.append('Paid follow-up consultation reserved')

            if ct_label:
                parts.append(f'Type: {ct_label}')

            if fu_slot:
                slot_date = getattr(fu_slot, 'date', None)
                slot_start = getattr(fu_slot, 'start_time', None)
                slot_end = getattr(fu_slot, 'end_time', None)
                if slot_date:
                    parts.append(f'Date: {slot_date.strftime("%d %B %Y")}')
                if slot_start and slot_end:
                    parts.append(f'Time: {slot_start.strftime("%I:%M %p")} - {slot_end.strftime("%I:%M %p")}')
            elif fu_date:
                parts.append(f'Suggested Date: {fu_date.strftime("%d %B %Y")}')

            structured_text = '\n'.join(parts)
            if follow_up_text:
                follow_up_text = f'{follow_up_text}\n\n{structured_text}'
            else:
                follow_up_text = structured_text

        if follow_up_text and sec_visible('follow_up'):
            if y > 260:
                pdf.add_page()
                y = 15
            pdf.set_xy(12, y)
            pdf.set_font('Helvetica', 'B', 10)
            pdf.cell(0, 6, sec_label('follow_up'))
            y += 7
            pdf.set_xy(12, y)
            pdf.set_font('Helvetica', '', 9)
            pdf.multi_cell(186, 5, follow_up_text)
            y = pdf.get_y() + 3

        # ─── SIGNATURE (reference style: image LEFT, text RIGHT) ────
        # Layout: [signature image] | Digitally signed by Dr. [Name]
        #                           | Qualification
        #                           | Reg No: ...
        #                           | Date: ... | Time: ...
        # No border, no box — clean side-by-side
        if y > 230:
            pdf.add_page()
            y = 15

        y += 5
        pdf.set_draw_color(200, 200, 200)
        pdf.line(10, y, 200, y)
        y += 5

        sig_img_path, is_digital_sig = _get_signature_image(doc) if doc else (None, False)
        now_ts = datetime.now(timezone.utc)
        sign_datetime = p.issue_date.strftime('%d %B %Y') if p.issue_date else now_ts.strftime('%d %B %Y')
        sign_time = now_ts.strftime('%H:%M:%S')

        qual_str = (getattr(p, 'doctor_qualification_snapshot', None) or _get_qualification_str(doc)) if doc else None
        reg_no = getattr(doc, 'registration_number', None) if doc else None

        sig_block_start_y = y

        # ── SIGNATURE BOX ─────────────────────────────────────────────────
        # All borders are WHITE (invisible but structurally present).
        # Top row: [LEFT 58% — signature image RIGHT-aligned]
        #          [RIGHT 42% — 4-line italic text LEFT-aligned]
        # Horizontal divider (white).
        # Bottom row: Dr. Name + Qual + Reg No CENTRED.

        # Use white draw color → invisible borders
        pdf.set_draw_color(255, 255, 255)
        pdf.set_line_width(0.3)

        box_w = 95            # total box width (mm) — right-aligned (narrower, truly right side)
        box_x = 200 - box_w   # x=105 so box ends at x=200
        top_h = 22            # top row height

        # Calculate bottom row height based on content
        bottom_lines = 1 + (1 if qual_str else 0) + (1 if reg_no else 0)
        bottom_h = 4 + bottom_lines * 4   # 4mm padding + 4mm per line

        # Outer rectangle (white = invisible)
        pdf.rect(box_x, sig_block_start_y, box_w, top_h + bottom_h)

        # Vertical split (58% left, 42% right) — white/invisible
        vert_x = box_x + int(box_w * 0.58)
        pdf.line(vert_x, sig_block_start_y, vert_x, sig_block_start_y + top_h)

        # Horizontal divider — white/invisible
        horiz_y = sig_block_start_y + top_h
        pdf.line(box_x, horiz_y, box_x + box_w, horiz_y)

        # ── Signature image: RIGHT-aligned within left cell ──
        if sig_img_path:
            left_cell_w = vert_x - box_x
            img_w = min(left_cell_w - 8, 42)
            img_h = min(top_h - 4, 14)
            # Right-align: place image so its right edge is at vert_x - 2mm padding
            img_x = vert_x - 2 - img_w
            img_y = sig_block_start_y + (top_h - img_h) / 2
            try:
                pdf.image(sig_img_path, x=img_x, y=img_y, w=img_w, h=img_h)
            except Exception:
                pass

        # ── Digitally signed text: 4 lines, LEFT-aligned in right cell ──
        if doc:
            right_cell_x = vert_x + 2        # 2mm left padding inside right cell
            right_cell_w = (box_x + box_w - 2) - right_cell_x  # leave 2mm right margin
            line_h = 3.2
            txt_y = sig_block_start_y + (top_h - 4 * line_h) / 2  # vertically centred
            pdf.set_font('Helvetica', 'I', 4.8)
            pdf.set_text_color(90, 90, 90)
            for line_text in [
                'Digitally signed by',
                f'Dr. {doc.full_name}',
                f'Date: {sign_datetime}',
                f'Time: {sign_time} UTC',
            ]:
                pdf.set_xy(right_cell_x, txt_y)
                pdf.cell(right_cell_w, line_h, line_text, align='L')
                txt_y += line_h
            pdf.set_text_color(0, 0, 0)

        # ── Bottom row: CENTRED ──
        bot_y = horiz_y + 3
        if doc:
            pdf.set_xy(box_x, bot_y)
            pdf.set_font('Helvetica', 'B', 9)
            pdf.cell(box_w, 4, f'Dr. {doc.full_name}', align='C')
            bot_y += 4
            if qual_str:
                pdf.set_xy(box_x, bot_y)
                pdf.set_font('Helvetica', '', 7.5)
                pdf.cell(box_w, 3.5, qual_str, align='C')
                bot_y += 3.5
            if reg_no:
                pdf.set_xy(box_x, bot_y)
                pdf.set_font('Helvetica', '', 7.5)
                pdf.cell(box_w, 3.5, f'Reg No: {reg_no}', align='C')
                bot_y += 3.5

        y = sig_block_start_y + top_h + bottom_h + 3

        # Restore draw color to default
        pdf.set_draw_color(0, 0, 0)

        # Clean up downloaded signature image
        _cleanup_temp(sig_img_path)

        # ─── E-PRESCRIPTION VALIDITY LINE ───────────────────────
        if y > 275:
            pdf.add_page()
            y = 15

        validity_str = ''
        if p.valid_until:
            validity_str = f'This e-prescription is valid until {p.valid_until.strftime("%d %B %Y")}.'
        else:
            validity_str = 'This e-prescription is valid for 30 days from the date of issue.'

        pdf.set_xy(10, y)
        pdf.set_font('Helvetica', 'I', 8)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(190, 5, validity_str, align='C')
        pdf.set_text_color(0, 0, 0)
        y += 7

        # ─── DISCLAIMER ────────────────────────────────────────
        if disclaimer is None:
            disclaimer = getattr(tpl, 'disclaimer_text', None) if tpl else None
        if disclaimer:
            if y > 265:
                pdf.add_page()
                y = 15
            pdf.set_draw_color(220, 220, 220)
            pdf.line(10, y, 200, y)
            y += 3
            pdf.set_xy(12, y)
            pdf.set_font('Helvetica', 'B', 8)
            _title = disclaimer_title or (
                getattr(tpl, 'disclaimer_title', 'DISCLAIMER') if tpl else 'DISCLAIMER'
            ) or 'DISCLAIMER'
            pdf.cell(0, 5, _title)
            y += 5
            pdf.set_xy(12, y)
            pdf.set_font('Helvetica', '', 7)
            pdf.multi_cell(186, 4, disclaimer)

        # ─── OUTPUT & UPLOAD ────────────────────────────────────
        pdf_bytes = pdf.output()
        pdf_buffer = io.BytesIO(pdf_bytes)

        # get_client() must be given the bucket: with no argument it always
        # builds the AWS client, which blows up with NoCredentialsError when
        # the private bucket is MinIO-backed.
        bucket = current_app.config['AWS_S3_PRIVATE_BUCKET']
        s3 = S3Service.get_client(bucket)
        s3_key = f'prescriptions/{str(p.id)}/{uuid.uuid4().hex}.pdf'

        s3.upload_fileobj(
            pdf_buffer,
            bucket,
            s3_key,
            ExtraArgs={'ContentType': 'application/pdf'},
        )

        return f'{bucket}::{s3_key}'

    except Exception as e:
        logger.error(f'Failed to generate prescription PDF: {e}', exc_info=True)
        return None
