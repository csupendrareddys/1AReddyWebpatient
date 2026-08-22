"""
Bill / Invoice PDF generation service.
Generates a professional invoice PDF for doctor payouts.
Uploads to S3 and returns a presigned URL.
"""
import io
import logging
import uuid
from datetime import datetime, timezone

from fpdf import FPDF

from app.services.s3_service import S3Service

logger = logging.getLogger(__name__)


class BillPDF(FPDF):
    """Custom PDF class for bill/invoice generation."""

    def __init__(self, company_info):
        super().__init__()
        self.company = company_info or {}

    def header(self):
        # Company name
        self.set_font('Helvetica', 'B', 18)
        self.set_text_color(25, 60, 120)
        self.cell(0, 10, self.company.get('name', 'JL Triangle Private Limited'), ln=True, align='C')

        # Tagline
        if self.company.get('tagline'):
            self.set_font('Helvetica', 'I', 10)
            self.set_text_color(100, 100, 100)
            self.cell(0, 5, self.company['tagline'], ln=True, align='C')

        # Registration details line
        self.set_font('Helvetica', '', 7)
        self.set_text_color(120, 120, 120)
        parts = []
        if self.company.get('pan'):
            parts.append(f"PAN: {self.company['pan']}")
        if self.company.get('gst_reg'):
            parts.append(f"GST: {self.company['gst_reg']}")
        if self.company.get('cin'):
            parts.append(f"CIN: {self.company['cin']}")
        if self.company.get('sac'):
            parts.append(f"SAC: {self.company['sac']}")
        if parts:
            self.cell(0, 5, '  |  '.join(parts), ln=True, align='C')

        self.ln(2)
        # Divider line
        self.set_draw_color(25, 60, 120)
        self.set_line_width(0.5)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def footer(self):
        self.set_y(-25)
        self.set_draw_color(200, 200, 200)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(3)
        if self.company.get('footer_note'):
            self.set_font('Helvetica', 'I', 7)
            self.set_text_color(150, 150, 150)
            self.cell(0, 4, self.company['footer_note'], ln=True, align='C')
        if self.company.get('support_email'):
            self.set_font('Helvetica', '', 7)
            self.set_text_color(150, 150, 150)
            self.cell(0, 4, f"Support: {self.company['support_email']}", ln=True, align='C')
        self.set_font('Helvetica', '', 6)
        self.cell(0, 4, 'This is a computer-generated document. No signature required.', ln=True, align='C')


def generate_bill_pdf(payout):
    """
    Generate invoice PDF for a DoctorPayout record.
    Returns the presigned S3 URL or None on failure.
    """
    from app.models import BillingConfig

    try:
        config = BillingConfig.query.filter_by(is_active=True).first()
        company = {}
        if config:
            company = {
                'name': config.bill_company_name or 'JL Triangle Private Limited',
                'tagline': config.bill_company_tagline or '',
                'pan': config.bill_pan or '',
                'gst_reg': config.bill_gst_reg or '',
                'cin': config.bill_cin or '',
                'sac': config.bill_sac or '',
                'support_email': config.bill_support_email or '',
                'footer_note': config.bill_footer_note or '',
            }
        # Charge labels come from the payout doctor's active membership plan
        # (the amounts themselves are already stored on the payout row).
        from app.api.common.payment.billing_service import resolve_charge_names
        charge_names = list(resolve_charge_names(payout.doctor)) if payout.doctor \
            else ['Charge 1', 'Charge 2', 'Charge 3']

        pdf = BillPDF(company)
        pdf.add_page()

        # ── Title ──
        pdf.set_font('Helvetica', 'B', 14)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(0, 10, 'PAYOUT INVOICE', ln=True, align='C')
        pdf.ln(2)

        # ── Bill number & date ──
        pdf.set_font('Helvetica', 'B', 9)
        pdf.set_text_color(60, 60, 60)
        y = pdf.get_y()
        pdf.cell(95, 6, f"Bill Number: {payout.bill_number}", align='L')
        bill_date = payout.created_at.strftime('%d %b %Y') if payout.created_at else '-'
        pdf.cell(95, 6, f"Date: {bill_date}", align='R', ln=True)
        pdf.ln(4)

        # ── Doctor & Patient info ──
        doctor_name = '-'
        doctor_email = ''
        if payout.doctor and payout.doctor.user:
            u = payout.doctor.user
            doctor_name = f"{u.first_name or ''} {u.last_name or ''}".strip()
            doctor_email = u.email or ''

        patient_name = '-'
        appt_date = '-'
        appt_time = ''
        if payout.appointment:
            a = payout.appointment
            if a.appointment_date:
                appt_date = a.appointment_date.strftime('%d %b %Y')
            if hasattr(a, 'start_time') and a.start_time:
                appt_time = str(a.start_time)
            if a.patient and a.patient.user:
                pu = a.patient.user
                patient_name = f"{pu.first_name or ''} {pu.last_name or ''}".strip()

        pdf.set_font('Helvetica', '', 9)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(95, 5, f"Doctor: {doctor_name}", align='L')
        pdf.cell(95, 5, f"Patient: {patient_name}", align='R', ln=True)
        if doctor_email:
            pdf.cell(95, 5, f"Email: {doctor_email}", align='L')
        else:
            pdf.cell(95, 5, '', align='L')
        pdf.cell(95, 5, f"Appointment Date: {appt_date} {appt_time}", align='R', ln=True)
        pdf.ln(6)

        # ── Charges Table ──
        pdf.set_draw_color(180, 180, 180)
        pdf.set_line_width(0.3)

        col_w = [120, 70]  # Description, Amount

        # Table header
        pdf.set_font('Helvetica', 'B', 9)
        pdf.set_fill_color(240, 240, 240)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(col_w[0], 7, 'Description', border=1, fill=True, align='L')
        pdf.cell(col_w[1], 7, 'Amount', border=1, fill=True, align='R')
        pdf.ln()

        pdf.set_font('Helvetica', '', 9)

        def _row(desc, amount, bold=False, bg=False):
            if bold:
                pdf.set_font('Helvetica', 'B', 9)
            if bg:
                pdf.set_fill_color(230, 245, 230)
            pdf.cell(col_w[0], 6, desc, border='LR', fill=bg, align='L')
            pdf.cell(col_w[1], 6, amount, border='LR', fill=bg, align='R')
            pdf.ln()
            if bold:
                pdf.set_font('Helvetica', '', 9)

        _row('Consultation Fee', f"Rs. {payout.appointment_amount}")
        _row('Payment Received from Patient', f"Rs. {payout.payment_amount}")

        # Separator
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(245, 245, 245)
        pdf.cell(col_w[0] + col_w[1], 5, 'Deductions', border=1, fill=True, align='C')
        pdf.ln()
        pdf.set_font('Helvetica', '', 9)

        _row(f"  {charge_names[0]}", f"- Rs. {payout.charge1_amount}")
        _row(f"  {charge_names[1]}", f"- Rs. {payout.charge2_amount}")
        _row(f"  {charge_names[2]}", f"- Rs. {payout.charge3_amount}")
        _row('Total Platform Charges', f"- Rs. {payout.total_charges}", bold=True)
        _row('GST (CGST + SGST)', f"Rs. {payout.taxes_gst}")
        _row('TDS Deducted', f"- Rs. {payout.tds_amount}")
        _row('Razorpay Fee', f"- Rs. {payout.razorpay_fee}")

        # Final payout (highlighted)
        pdf.set_font('Helvetica', 'B', 10)
        pdf.set_fill_color(220, 240, 220)
        pdf.set_text_color(0, 100, 0)
        pdf.cell(col_w[0], 8, 'Final Payout to Doctor', border=1, fill=True, align='L')
        pdf.cell(col_w[1], 8, f"Rs. {payout.payout_amount}", border=1, fill=True, align='R')
        pdf.ln()
        pdf.set_text_color(0, 0, 0)

        # ── Bank Details ──
        if payout.bank_account:
            ba = payout.bank_account
            pdf.ln(6)
            pdf.set_font('Helvetica', 'B', 9)
            pdf.cell(0, 6, 'Paid to Bank Account:', ln=True)
            pdf.set_font('Helvetica', '', 9)
            pdf.cell(0, 5, f"Bank: {ba.bank_name or '-'}  |  A/C: ****{ba.account_number[-4:] if ba.account_number else '----'}  |  IFSC: {ba.ifsc_code or '-'}", ln=True)
            if ba.account_name:
                pdf.cell(0, 5, f"Account Holder: {ba.account_name}", ln=True)

        # ── Razorpay Reference ──
        if payout.razorpay_transfer_id:
            pdf.ln(3)
            pdf.set_font('Helvetica', '', 7)
            pdf.set_text_color(130, 130, 130)
            pdf.cell(0, 4, f"Razorpay Reference: {payout.razorpay_transfer_id}", ln=True)

        # ── Upload to S3 ──
        pdf_bytes = pdf.output()
        buffer = io.BytesIO(pdf_bytes)
        buffer.content_type = 'application/pdf'
        buffer.seek(0)

        file_name = f"bill_{payout.bill_number}.pdf"

        result = S3Service.upload_file(
            buffer,
            asset_type='invoices',
            original_filename=file_name,
            is_private=True,
            folder=f'bills/{payout.doctor_id}',
        )

        if result and result.get('s3_key'):
            url = S3Service.generate_presigned_url(result['s3_bucket'], result['s3_key'])
            logger.info(f"[BILL_PDF] Generated PDF for payout {payout.bill_number}")
            return url

        logger.warning(f"[BILL_PDF] S3 upload returned no key for {payout.bill_number}")
        return None

    except Exception as e:
        logger.exception(f"[BILL_PDF] Failed to generate bill PDF for {payout.bill_number}: {e}")
        return None
