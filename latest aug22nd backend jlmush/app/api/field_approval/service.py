"""
Field Approval Service
Business logic for field-level approval workflow.
"""
import datetime as _dt
import logging
from datetime import datetime, timezone
from decimal import Decimal as _Decimal
from app.extensions import db
from app.common.profile_audit import self_approving_admin
from app.common.tenant_context import current_tenant_id_strict

logger = logging.getLogger(__name__)
from app.models import (
    FieldApprovalRequest, FieldApprovalStatus, PublishStatus,
    Doctor, Admin, User, UserRole,
)

# Review comment on a request that was reviewed the instant it was raised —
# see :meth:`FieldApprovalService._review_support_edit`.
SUPPORT_EDIT_REVIEW_COMMENT = (
    "Raised from Operations by an admin acting on this member's behalf, "
    "and reviewed by them on submission."
)


# ---------------------------------------------------------------------------
# Required fields per section for profile completion calculation.
#
# Each value is a list of field specs.  A spec is either:
#   - a plain string  → checked as a direct model attribute
#   - a dict with a 'check' key describing how to resolve the value:
#       check='relationship'  → look up a one-to-one backref, then read `attr`
#       check='relationship_exists' → True if the relationship has ≥1 row
#       check='json_key'     → read `json_field[key]` on the entity
#       check='user_attr'    → read the attribute from entity.user
# ---------------------------------------------------------------------------

DOCTOR_REQUIRED_FIELDS = {
    # ── 1. Personal & Professional Details ──
    'personal_details': [
        'profile_image',
        'first_name',
        'middle_name',
        'last_name',
        {'check': 'user_attr', 'attr': 'phone', 'label': 'phone'},
        {'check': 'user_attr', 'attr': 'email', 'label': 'email'},
        'dob',
        'registration_number',
        'experience_years',
    ],

    # ── 2. Additional Personal Details ──
    'additional_personal_details': [
        'alternative_phone',
        'alternative_email',
        'height',
        'weight',
        'category',
        'religion',
        'citizenship',
        'languages_known',
    ],

    # ── 3. Identity Documents ──
    'identity_documents': [
        'aadhar_number',
        'aadhar_attachment',
        'pan_number',
        'pan_attachment',
    ],

    # ── 4. Communication (Current) Address ──
    'current_address': [
        {'check': 'json_key', 'json_field': 'communication_address', 'key': 'current_address', 'label': 'address'},
        {'check': 'json_key', 'json_field': 'communication_address', 'key': 'current_landmark', 'label': 'landmark'},
        {'check': 'json_key', 'json_field': 'communication_address', 'key': 'current_city', 'label': 'city'},
        {'check': 'json_key', 'json_field': 'communication_address', 'key': 'current_district', 'label': 'district'},
        {'check': 'json_key', 'json_field': 'communication_address', 'key': 'current_state', 'label': 'state'},
        {'check': 'json_key', 'json_field': 'communication_address', 'key': 'current_pincode', 'label': 'pincode'},
        {'check': 'json_key', 'json_field': 'communication_address', 'key': 'current_country', 'label': 'country'},
    ],

    # ── 5. Permanent Address ──
    'permanent_address': [
        {'check': 'json_key', 'json_field': 'permanent_address', 'key': 'permanent_address', 'label': 'address'},
        {'check': 'json_key', 'json_field': 'permanent_address', 'key': 'permanent_landmark', 'label': 'landmark'},
        {'check': 'json_key', 'json_field': 'permanent_address', 'key': 'permanent_city', 'label': 'city'},
        {'check': 'json_key', 'json_field': 'permanent_address', 'key': 'permanent_district', 'label': 'district'},
        {'check': 'json_key', 'json_field': 'permanent_address', 'key': 'permanent_state', 'label': 'state'},
        {'check': 'json_key', 'json_field': 'permanent_address', 'key': 'permanent_pincode', 'label': 'pincode'},
        {'check': 'json_key', 'json_field': 'permanent_address', 'key': 'permanent_country', 'label': 'country'},
    ],

    # ── 6. Signatures (3 fields — signature1, signature2, digital) ──
    'signatures': [
        {'check': 'relationship', 'rel': 'signature_record', 'attr': 'signature1_url', 'label': 'signature_1'},
        {'check': 'relationship', 'rel': 'signature_record', 'attr': 'signature2_url', 'label': 'signature_2'},
        {'check': 'relationship', 'rel': 'signature_record', 'attr': 'digital_signature_url', 'label': 'digital_signature'},
    ],

    # ── 7. About Me (3 sub-fields, each with text + attachment) ──
    'about_me': [
        {'check': 'relationship', 'rel': 'about_record', 'attr': 'brief_about_text', 'label': 'brief_about'},
        {'check': 'relationship', 'rel': 'about_record', 'attr': 'brief_about_attachment_url', 'label': 'brief_about_attachment'},
        {'check': 'relationship', 'rel': 'about_record', 'attr': 'nature_of_work_text', 'label': 'nature_of_work'},
        {'check': 'relationship', 'rel': 'about_record', 'attr': 'nature_of_work_attachment_url', 'label': 'nature_of_work_attachment'},
        {'check': 'relationship', 'rel': 'about_record', 'attr': 'currently_working_with_text', 'label': 'currently_working_with'},
        {'check': 'relationship', 'rel': 'about_record', 'attr': 'currently_working_with_attachment_url', 'label': 'currently_working_with_attachment'},
    ],

    # ── 8. Education — shown hierarchically as sub-sections ──
    # All levels share the qualifications relationship (no degree_type column),
    # so we track a single "at least 1 qualification" check here.
    # The frontend renders the 4 sub-section labels from this parent section.
    'education': [
        {'check': 'relationship_exists', 'rel': 'qualifications', 'label': 'qualification_records'},
    ],

    # ── 9. Bank Details (fields from primary bank account) ──
    'bank_details': [
        {'check': 'bank_field', 'attr': 'bank_name', 'label': 'bank_name'},
        {'check': 'bank_field', 'attr': 'account_name', 'label': 'account_holder_name'},
        {'check': 'bank_field', 'attr': 'account_number', 'label': 'account_number'},
        {'check': 'bank_field', 'attr': 'ifsc_code', 'label': 'ifsc_code'},
        {'check': 'bank_field', 'attr': 'branch', 'label': 'branch'},
        {'check': 'bank_field', 'attr': 'passbook_url', 'label': 'passbook'},
        {'check': 'bank_field', 'attr': 'check_leaf_url', 'label': 'check_leaf'},
        {'check': 'bank_field', 'attr': 'bank_statement_url', 'label': 'bank_statement'},
    ],

    # ── 10. Declaration & Documents ──
    'declaration_documents': [
        {'check': 'json_key', 'json_field': 'self_declaration_data', 'key': 'terms_accepted', 'label': 'terms_accepted'},
        {'check': 'json_key', 'json_field': 'self_declaration_data', 'key': 'policies_accepted', 'label': 'policies_accepted'},
    ],
}

ADMIN_REQUIRED_FIELDS = {
    'personal_details': ['first_name', 'last_name'],
}

# These moved off Doctor/Admin onto User. Both models still expose them as
# read-only property shims that resolve through ``entity.user``, so writing
# them on the entity raises AttributeError ("property 'first_name' of
# 'Doctor' object has no setter"). Approvals must write them on User.
USER_OWNED_FIELDS = {
    'first_name', 'middle_name', 'last_name', 'gender', 'dob', 'profile_image',
    # Contact identity — a doctor's phone/email change is OTP-verified up front
    # then held here PENDING until an admin approves (section 'contact'). Applied
    # to the User at approval time, with a uniqueness re-check (see below).
    'phone_number', 'email',
}

# ── About Me approval ────────────────────────────────────────────────────────
# The About tab writes the new value to the ProfileAbout record IMMEDIATELY and
# marks the field PENDING (Pattern B — unlike personal_details, which holds the
# new value in the request until approved). So About requests carry the old/new
# captured at save time (see ``save_about``), and approve/reject only flip the
# record-level ``verification_status`` back onto the record — the value is
# already live. ``about_me`` is the section the admin queue filters on and the
# doctor's AboutMeSection reads its chips from.
ABOUT_SECTION = 'about_me'

# ── Education approval ────────────────────────────────────────────────────────
# Education mirrors About's Pattern B: ``save_education`` writes the new values
# immediately and then queues one request per changed SUB-SECTION (graduation /
# post_graduation / super_speciality / other_certification). approve/reject only
# flips the record-level ``*_certificate/marksheet_verification_status`` on the
# ProfileEducation row — the value is already live. ``education`` is the section
# the admin "Education Approvals" queue filters on.
EDUCATION_SECTION = 'education'
EDUCATION_SUBSECTIONS = (
    'graduation', 'post_graduation', 'super_speciality', 'other_certification',
)

# about_me request field_name → the ProfileAbout column whose verification
# status the approve/reject decision writes. ``work_qualifications`` is handled
# separately (it lives on the ProfileWorkQualification link rows).
ABOUT_VERIFICATION_COLUMN = {
    'brief_about': 'brief_about_verification_status',
    'brief_about_attachment': 'brief_about_verification_status',
    'nature_of_work': 'nature_of_work_verification_status',
    'nature_of_work_attachment': 'nature_of_work_verification_status',
    'currently_working_with': 'currently_working_with_verification_status',
    'currently_working_with_attachment': 'currently_working_with_verification_status',
}


class FieldApprovalService:
    """Handles field-level approval requests for doctor/admin profile changes."""

    @staticmethod
    @staticmethod
    def _json_safe(value):
        """Coerce a field value into something the ``old_value`` / ``new_value``
        JSON columns can persist. Dates / datetimes → ISO strings, Decimals →
        float; dicts / lists are recursed. Without this a ``dob`` (a
        ``datetime.date``) raises ``Object of type date is not JSON
        serializable`` on flush and rolls the whole request back."""
        if isinstance(value, (_dt.date, _dt.datetime)):
            return value.isoformat()
        if isinstance(value, _Decimal):
            return float(value)
        if isinstance(value, dict):
            return {k: FieldApprovalService._json_safe(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [FieldApprovalService._json_safe(v) for v in value]
        return value

    @staticmethod
    def submit_changes(submitted_by_id, entity_type, entity_id, section, changes):
        """
        Submit field changes for approval.
        Creates a FieldApprovalRequest for each changed field.

        Args:
            submitted_by_id: UUID of the user submitting the change
            entity_type: 'doctor' or 'admin'
            entity_id: UUID of the doctor or admin
            section: Section name (e.g. 'personal_details', 'signatures')
            changes: Dict of {field_name: new_value}

        Returns:
            List of created FieldApprovalRequest objects
        """
        entity = FieldApprovalService._get_entity(entity_type, entity_id)
        if not entity:
            return []

        requests = []
        for field_name, new_value in changes.items():
            # Get the old value from the entity, coercing both sides to
            # JSON-safe primitives (the columns are JSON — a raw date crashes
            # the flush) before comparing / storing.
            old_value = FieldApprovalService._json_safe(
                FieldApprovalService._get_field_value(entity, section, field_name))
            new_value = FieldApprovalService._json_safe(new_value)

            # Skip if value hasn't actually changed
            if old_value == new_value:
                continue

            # Cancel any existing pending request for the same field
            existing = FieldApprovalRequest.query.filter_by(
                tenant_id=current_tenant_id_strict(),
                entity_type=entity_type,
                entity_id=entity_id,
                section=section,
                field_name=field_name,
                status=FieldApprovalStatus.PENDING,
            ).first()
            if existing:
                existing.status = FieldApprovalStatus.REJECTED
                existing.review_comment = 'Superseded by new submission'
                existing.reviewed_at = datetime.now(timezone.utc)

            is_file = isinstance(new_value, str) and (
                new_value.startswith('s3://') or
                new_value.startswith('uploads/') or
                field_name.endswith('_attachment') or
                field_name.endswith('_image')
            )

            req = FieldApprovalRequest(
                tenant_id=current_tenant_id_strict(),
                submitted_by_id=submitted_by_id,
                entity_type=entity_type,
                entity_id=entity_id,
                section=section,
                field_name=field_name,
                old_value=old_value,
                new_value=new_value,
                is_file_field=is_file,
                status=FieldApprovalStatus.PENDING,
            )
            db.session.add(req)
            requests.append(req)

        db.session.commit()
        # Auto-review when an admin raised this on the member's behalf (main).
        requests = FieldApprovalService._review_support_edit(requests)
        # Policy-based auto-approve when the doctor's section mode is 'auto'
        # (acts only on requests still PENDING after the support review).
        if entity_type == 'doctor':
            FieldApprovalService._auto_approve_if_configured(entity, section, requests)
        return requests

    @staticmethod
    def _auto_approve_if_configured(entity, section, requests):
        """Auto-approve the just-created requests when this doctor's effective
        permission mode for ``section`` is 'auto' (tenant policy or per-doctor
        override). Reuses the tested approve path — applies the value + marks
        APPROVED. 'manual' sections stay PENDING. Never blocks a submit."""
        if not requests or entity is None:
            return
        try:
            from app.api.admin.approval_policy_service import effective_permission_mode
            if effective_permission_mode(entity, section) != 'auto':
                return
            for r in requests:
                FieldApprovalService.approve_request(
                    r.id, reviewer_id=None,
                    comment='Auto-approved by approval policy')
        except Exception:  # pragma: no cover — never block a submit on this
            logger.exception('[FIELD_APPROVAL] auto-approve check failed; left PENDING')

    @staticmethod
    def submit_about_changes(submitted_by_id, entity_id, changes):
        """Create ``about_me`` approval requests for a doctor's just-saved About edits.

        ``changes`` is a list of ``{'field', 'old', 'new', 'is_file'}`` captured by
        ``save_about`` (which already wrote the values to the record). One request
        per changed field; a still-pending request for the same field is
        superseded, mirroring ``submit_changes``. Returns the created requests.
        """
        tid = current_tenant_id_strict()
        created = []
        for ch in (changes or []):
            field_name = ch.get('field')
            if not field_name:
                continue
            existing = FieldApprovalRequest.query.filter_by(
                tenant_id=tid, entity_type='doctor', entity_id=str(entity_id),
                section=ABOUT_SECTION, field_name=field_name,
                status=FieldApprovalStatus.PENDING,
            ).first()
            if existing:
                existing.status = FieldApprovalStatus.REJECTED
                existing.review_comment = 'Superseded by new submission'
                existing.reviewed_at = datetime.now(timezone.utc)

            req = FieldApprovalRequest(
                tenant_id=tid, submitted_by_id=submitted_by_id,
                entity_type='doctor', entity_id=str(entity_id),
                section=ABOUT_SECTION, field_name=field_name,
                old_value=FieldApprovalService._json_safe(ch.get('old')),
                new_value=FieldApprovalService._json_safe(ch.get('new')),
                is_file_field=bool(ch.get('is_file')),
                status=FieldApprovalStatus.PENDING,
            )
            db.session.add(req)
            created.append(req)

        db.session.commit()
        created = FieldApprovalService._review_support_edit(created)
        FieldApprovalService._auto_approve_if_configured(
            FieldApprovalService._get_entity('doctor', str(entity_id)),
            ABOUT_SECTION, created)
        return created

    @staticmethod
    def submit_education_changes(submitted_by_id, entity_id, changes):
        """Create ``education`` approval requests for a doctor's just-saved edits.

        ``changes`` is the list ``save_education`` returns — one
        ``{'field', 'old', 'new', 'is_file'}`` per changed sub-section (the
        value is already written). One request per sub-section; a still-pending
        request for the same sub-section is superseded. Returns the created
        requests. Mirrors ``submit_about_changes``.
        """
        tid = current_tenant_id_strict()
        created = []
        for ch in (changes or []):
            field_name = ch.get('field')
            if not field_name:
                continue
            existing = FieldApprovalRequest.query.filter_by(
                tenant_id=tid, entity_type='doctor', entity_id=str(entity_id),
                section=EDUCATION_SECTION, field_name=field_name,
                status=FieldApprovalStatus.PENDING,
            ).first()
            if existing:
                existing.status = FieldApprovalStatus.REJECTED
                existing.review_comment = 'Superseded by new submission'
                existing.reviewed_at = datetime.now(timezone.utc)

            req = FieldApprovalRequest(
                tenant_id=tid, submitted_by_id=submitted_by_id,
                entity_type='doctor', entity_id=str(entity_id),
                section=EDUCATION_SECTION, field_name=field_name,
                old_value=FieldApprovalService._json_safe(ch.get('old')),
                new_value=FieldApprovalService._json_safe(ch.get('new')),
                is_file_field=bool(ch.get('is_file')),
                status=FieldApprovalStatus.PENDING,
            )
            db.session.add(req)
            created.append(req)

        db.session.commit()
        created = FieldApprovalService._review_support_edit(created)
        FieldApprovalService._auto_approve_if_configured(
            FieldApprovalService._get_entity('doctor', str(entity_id)),
            EDUCATION_SECTION, created)
        return created

    @staticmethod
    def _apply_education_review(req, new_status):
        """Reflect an education approve/reject onto the record-level verification.

        The education value is already live (Pattern B), so this only flips the
        sub-section's certificate + marksheet verification columns on the
        ProfileEducation row to VERIFIED / REJECTED.
        """
        from app.models import ProfileEducation, DocumentVerificationStatus

        doc_status = (
            DocumentVerificationStatus.VERIFIED
            if new_status == FieldApprovalStatus.APPROVED
            else DocumentVerificationStatus.REJECTED
        )
        tid = current_tenant_id_strict()
        record = ProfileEducation.query.filter_by(
            tenant_id=tid, doctor_id=req.entity_id,
        ).first()
        if not record:
            return
        sub = req.field_name
        for suffix in ('certificate', 'marksheet'):
            col = f'{sub}_{suffix}_verification_status'
            if hasattr(record, col):
                setattr(record, col, doc_status)

    @staticmethod
    def _apply_about_review(req, new_status):
        """Reflect an about_me approve/reject onto the record-level verification.

        The About value is already live (Pattern B), so this only flips the
        ProfileAbout column (or every work-qualification row) to VERIFIED /
        REJECTED so the doctor sees the reviewer's decision.
        """
        from app.models import ProfileAbout, DocumentVerificationStatus
        from app.models.profile_shared import ProfileWorkQualification

        doc_status = (
            DocumentVerificationStatus.VERIFIED
            if new_status == FieldApprovalStatus.APPROVED
            else DocumentVerificationStatus.REJECTED
        )
        tid = current_tenant_id_strict()

        if req.field_name == 'work_qualifications':
            for w in ProfileWorkQualification.query.filter_by(
                tenant_id=tid, doctor_id=req.entity_id,
            ).all():
                w.verification_status = doc_status
            return

        col = ABOUT_VERIFICATION_COLUMN.get(req.field_name)
        if not col:
            return
        record = ProfileAbout.query.filter_by(
            tenant_id=tid, doctor_id=req.entity_id,
        ).first()
        if record and hasattr(record, col):
            setattr(record, col, doc_status)

    @staticmethod
    def _review_support_edit(requests):
        """Review, on the spot, requests a senior admin raised from Operations.

        Returns ``requests`` untouched outside the act-on-behalf proxy — which
        is every request a doctor raises for themselves, so their edits queue
        exactly as they always have. Also untouched for an operator inside the
        proxy who is junior to :data:`~app.common.profile_audit
        .SELF_APPROVE_MIN_ROLE_LEVEL`: they can make the edit, it just waits
        for a reviewer, like the doctor's own.

        For a senior one the submitter already holds the approval right — the
        same right the approvals queue checks. Leaving the request pending would
        mean an operator fixing a doctor's registration number has to walk to a
        second screen and approve their own edit, while the queue fills with
        entries nobody is waiting on.

        Nothing is skipped: the request row is still written in full — old
        value, new value, section, submitter — and this stamps the real admin as
        its reviewer, so the change is as auditable as one that waited. Going
        through :meth:`approve_request` rather than writing the field directly is
        what keeps About and Education correct: those apply on save and their
        review only stamps verification.
        """
        admin = self_approving_admin()
        if admin is None:
            return requests
        return [
            FieldApprovalService.approve_request(
                req.id, admin.id, SUPPORT_EDIT_REVIEW_COMMENT,
            ) or req
            for req in requests
        ]

    @staticmethod
    def approve_request(request_id, reviewer_id, comment=None):
        """
        Approve a field change request.
        Applies the new_value to the actual Doctor/Admin model field.
        """
        req = FieldApprovalRequest.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=request_id,
        ).first()
        if not req or req.status != FieldApprovalStatus.PENDING:
            return None

        # About + education write their value immediately, so approving only
        # stamps the record-level verification; every other section applies
        # new_value now.
        if req.section == ABOUT_SECTION:
            FieldApprovalService._apply_about_review(req, FieldApprovalStatus.APPROVED)
        elif req.section == EDUCATION_SECTION:
            FieldApprovalService._apply_education_review(req, FieldApprovalStatus.APPROVED)
        else:
            entity = FieldApprovalService._get_entity(req.entity_type, req.entity_id)
            if entity:
                FieldApprovalService._set_field_value(
                    entity, req.section, req.field_name, req.new_value
                )

        req.status = FieldApprovalStatus.APPROVED
        req.reviewed_by_id = reviewer_id
        req.reviewed_at = datetime.now(timezone.utc)
        req.review_comment = comment

        db.session.commit()
        return req

    @staticmethod
    def reject_request(request_id, reviewer_id, comment=None):
        """Reject a field change request."""
        req = FieldApprovalRequest.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=request_id,
        ).first()
        if not req or req.status != FieldApprovalStatus.PENDING:
            return None

        # About + education keep their (already-live) value but are marked
        # REJECTED so the doctor sees it was declined and can re-edit — matching
        # how a rejected bank document behaves.
        if req.section == ABOUT_SECTION:
            FieldApprovalService._apply_about_review(req, FieldApprovalStatus.REJECTED)
        elif req.section == EDUCATION_SECTION:
            FieldApprovalService._apply_education_review(req, FieldApprovalStatus.REJECTED)

        req.status = FieldApprovalStatus.REJECTED
        req.reviewed_by_id = reviewer_id
        req.reviewed_at = datetime.now(timezone.utc)
        req.review_comment = comment

        db.session.commit()
        return req

    @staticmethod
    def query_request(request_id, reviewer_id, comment=None):
        """Raise a query on a field change request."""
        req = FieldApprovalRequest.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=request_id,
        ).first()
        if not req or req.status != FieldApprovalStatus.PENDING:
            return None

        req.status = FieldApprovalStatus.QUERY
        req.reviewed_by_id = reviewer_id
        req.reviewed_at = datetime.now(timezone.utc)
        req.review_comment = comment

        db.session.commit()
        return req

    @staticmethod
    def bulk_approve(request_ids, reviewer_id, comment=None):
        """Approve multiple requests at once."""
        results = []
        for rid in request_ids:
            result = FieldApprovalService.approve_request(rid, reviewer_id, comment)
            if result:
                results.append(result)
        return results

    @staticmethod
    def get_field_statuses(entity_type, entity_id):
        """
        Get approval statuses for all fields of an entity.
        Returns pending and recently approved/rejected requests.
        """
        tid = current_tenant_id_strict()
        requests = FieldApprovalRequest.query.filter(
            FieldApprovalRequest.tenant_id == tid,
            FieldApprovalRequest.entity_type == entity_type,
            FieldApprovalRequest.entity_id == entity_id,
            FieldApprovalRequest.status.in_([
                FieldApprovalStatus.PENDING,
                FieldApprovalStatus.QUERY,
            ]),
        ).order_by(FieldApprovalRequest.created_at.desc()).all()

        # Also get recently reviewed (within last 7 days) for status display
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        recent = FieldApprovalRequest.query.filter(
            FieldApprovalRequest.tenant_id == tid,
            FieldApprovalRequest.entity_type == entity_type,
            FieldApprovalRequest.entity_id == entity_id,
            FieldApprovalRequest.status.in_([
                FieldApprovalStatus.APPROVED,
                FieldApprovalStatus.REJECTED,
            ]),
            FieldApprovalRequest.reviewed_at >= cutoff,
        ).order_by(FieldApprovalRequest.reviewed_at.desc()).all()

        field_statuses = {}
        pending_count = 0

        for req in requests:
            key = f"{req.section}.{req.field_name}"
            if key not in field_statuses:
                field_statuses[key] = req.to_dict()
                if req.status == FieldApprovalStatus.PENDING:
                    pending_count += 1

        for req in recent:
            key = f"{req.section}.{req.field_name}"
            if key not in field_statuses:
                field_statuses[key] = req.to_dict()

        return {
            'field_statuses': field_statuses,
            'pending_count': pending_count,
        }

    @staticmethod
    def get_my_requests(submitted_by_id, entity_type=None, status=None, page=1, per_page=20):
        """Get approval requests submitted by a user."""
        query = FieldApprovalRequest.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            submitted_by_id=submitted_by_id,
        )

        if entity_type:
            query = query.filter_by(entity_type=entity_type)
        if status:
            query = query.filter_by(status=FieldApprovalStatus(status))

        query = query.order_by(FieldApprovalRequest.created_at.desc())
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)

        return {
            'requests': [r.to_dict() for r in pagination.items],
            'total': pagination.total,
            'page': pagination.page,
            'pages': pagination.pages,
        }

    @staticmethod
    def get_pending_requests(entity_type=None, section=None, page=1, per_page=20, status='pending'):
        """List field-approval requests for the reviewer queue.

        status: 'pending' (default, back-compat) | 'approved' | 'rejected' |
        'query' | 'all'. Anything unrecognised falls back to 'pending'.
        """
        query = FieldApprovalRequest.query.filter_by(
            tenant_id=current_tenant_id_strict(),
        )

        norm = (status or 'pending').lower()
        if norm != 'all':
            try:
                query = query.filter_by(status=FieldApprovalStatus(norm))
            except ValueError:
                query = query.filter_by(status=FieldApprovalStatus.PENDING)

        if entity_type:
            query = query.filter_by(entity_type=entity_type)
        if section:
            query = query.filter_by(section=section)

        query = query.order_by(FieldApprovalRequest.created_at.asc())
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)

        # Enrich with submitter info
        results = []
        for req in pagination.items:
            data = req.to_dict()
            # Add entity name
            entity = FieldApprovalService._get_entity(req.entity_type, req.entity_id)
            if entity:
                data['entity_name'] = entity.full_name if hasattr(entity, 'full_name') else str(req.entity_id)
            results.append(data)

        return {
            'requests': results,
            'total': pagination.total,
            'page': pagination.page,
            'pages': pagination.pages,
        }

    @staticmethod
    def get_profile_completion(entity_type, entity_id):
        """
        Calculate profile completion percentage.
        Returns completion info including missing fields and pending counts.
        """
        entity = FieldApprovalService._get_entity(entity_type, entity_id)
        if not entity:
            return None

        required_fields = DOCTOR_REQUIRED_FIELDS if entity_type == 'doctor' else ADMIN_REQUIRED_FIELDS

        total_fields = 0
        filled_fields = 0
        missing_fields = {}
        sections_status = {}

        for section, field_specs in required_fields.items():
            section_total = len(field_specs)
            section_filled = 0
            section_missing = []

            for spec in field_specs:
                total_fields += 1
                label, value = FieldApprovalService._resolve_field_spec(entity, spec)
                if value is not None and value != '' and value != [] and value is not False:
                    filled_fields += 1
                    section_filled += 1
                else:
                    section_missing.append(label)

            if section_missing:
                missing_fields[section] = section_missing

            sections_status[section] = {
                'total': section_total,
                'filled': section_filled,
                'missing': section_missing,
            }

        # Get pending approval counts per section
        tid = current_tenant_id_strict()
        pending_by_section = {}
        pending_requests = FieldApprovalRequest.query.filter(
            FieldApprovalRequest.tenant_id == tid,
            FieldApprovalRequest.entity_type == entity_type,
            FieldApprovalRequest.entity_id == entity_id,
            FieldApprovalRequest.status == FieldApprovalStatus.PENDING,
        ).all()

        for req in pending_requests:
            pending_by_section.setdefault(req.section, 0)
            pending_by_section[req.section] += 1

        # Get query counts
        query_requests = FieldApprovalRequest.query.filter(
            FieldApprovalRequest.tenant_id == tid,
            FieldApprovalRequest.entity_type == entity_type,
            FieldApprovalRequest.entity_id == entity_id,
            FieldApprovalRequest.status == FieldApprovalStatus.QUERY,
        ).all()

        query_by_section = {}
        for req in query_requests:
            query_by_section.setdefault(req.section, 0)
            query_by_section[req.section] += 1

        percentage = round((filled_fields / total_fields * 100), 1) if total_fields > 0 else 0

        return {
            'percentage': percentage,
            'total_fields': total_fields,
            'filled_fields': filled_fields,
            'missing_fields': missing_fields,
            'sections_status': sections_status,
            'pending_approvals_by_section': pending_by_section,
            'queries_by_section': query_by_section,
            'total_pending': len(pending_requests),
            'total_queries': len(query_requests),
        }

    @staticmethod
    def get_account_status(entity_type, entity_id):
        """
        Full account status: completion + publish status + pending approvals summary.
        """
        entity = FieldApprovalService._get_entity(entity_type, entity_id)
        if not entity:
            return None

        completion = FieldApprovalService.get_profile_completion(entity_type, entity_id)
        field_statuses = FieldApprovalService.get_field_statuses(entity_type, entity_id)

        publish_status = entity.publish_status.value if hasattr(entity, 'publish_status') and entity.publish_status else 'inactive'

        result = {
            'entity_type': entity_type,
            'entity_id': str(entity_id),
            'entity_name': entity.full_name if hasattr(entity, 'full_name') else '',
            'publish_status': publish_status,
            'publish_status_by_type': getattr(entity, 'publish_status_by_type', None) or {},
            'profile_completion': completion,
            'pending_count': field_statuses.get('pending_count', 0),
            'field_statuses': field_statuses.get('field_statuses', {}),
        }

        # For doctors, also include verification status and is_live
        if entity_type == 'doctor' and isinstance(entity, Doctor):
            result['verification_status'] = entity.verification_status.value if entity.verification_status else 'pending'
            result['is_live'] = entity.is_live

        return result

    @staticmethod
    def update_publish_status(entity_type, entity_id, new_status, updated_by_id):
        """
        Update global publish status (super admin only).
        For doctors, syncs is_live field.
        """
        entity = FieldApprovalService._get_entity(entity_type, entity_id)
        if not entity:
            return None

        entity.publish_status = PublishStatus(new_status)

        # Sync is_live for doctors
        if entity_type == 'doctor' and isinstance(entity, Doctor):
            entity.is_live = (entity.publish_status == PublishStatus.ACTIVE)

        db.session.commit()
        return entity

    @staticmethod
    def update_publish_status_by_type(entity_type, entity_id, status_by_type: dict, updated_by_id):
        """
        Update per-consultation-type publish status (super admin only).

        status_by_type: { "video": "active", "audio": "on_hold", "marketplace": "inactive", ... }
        Valid status values: active | inactive | on_hold | suspended
        The 'marketplace' key controls doctor product visibility — not a ConsultationType enum value.
        """
        from sqlalchemy.orm.attributes import flag_modified

        valid_statuses = {'active', 'inactive', 'on_hold', 'suspended'}
        for ct, st in status_by_type.items():
            if st not in valid_statuses:
                raise ValueError(f"Invalid status '{st}' for type '{ct}'. Must be one of {valid_statuses}")

        entity = FieldApprovalService._get_entity(entity_type, entity_id)
        if not entity:
            return None

        if not hasattr(entity, 'publish_status_by_type'):
            return None  # Admin model doesn't have per-type status

        current = dict(entity.publish_status_by_type or {})
        current.update(status_by_type)
        entity.publish_status_by_type = current
        flag_modified(entity, 'publish_status_by_type')

        # Sync global publish_status from per-type statuses.
        # ACTIVE if ANY type is active, INACTIVE otherwise.
        if entity_type == 'doctor' and isinstance(entity, Doctor):
            any_active = any(v == 'active' for v in current.values())
            if any_active:
                entity.publish_status = PublishStatus.ACTIVE
                entity.is_live = True
            else:
                entity.publish_status = PublishStatus.INACTIVE
                entity.is_live = False

        db.session.commit()
        return entity

    # --- Private helpers ---

    @staticmethod
    def _get_entity(entity_type, entity_id):
        """Get Doctor or Admin entity by type and ID, scoped to the current tenant."""
        tid = current_tenant_id_strict()
        if entity_type == 'doctor':
            return Doctor.query.filter_by(tenant_id=tid, id=entity_id).first()
        elif entity_type == 'admin':
            return Admin.query.filter_by(tenant_id=tid, id=entity_id).first()
        return None

    @staticmethod
    def _resolve_field_spec(entity, spec):
        """
        Resolve a field spec from DOCTOR_REQUIRED_FIELDS.

        Returns (label, value) where value is the resolved data (or None if missing).
        """
        # Plain string → direct model attribute
        if isinstance(spec, str):
            val = getattr(entity, spec, None)
            if hasattr(val, 'value'):
                val = val.value
            return spec, val

        check = spec.get('check')
        label = spec.get('label', spec.get('attr', spec.get('key', '?')))

        if check == 'user_attr':
            user = getattr(entity, 'user', None)
            val = getattr(user, spec['attr'], None) if user else None
            return label, val

        if check == 'json_key':
            json_data = getattr(entity, spec['json_field'], None) or {}
            val = json_data.get(spec['key']) if isinstance(json_data, dict) else None
            return label, val

        if check == 'relationship':
            rel_obj = getattr(entity, spec['rel'], None)
            val = getattr(rel_obj, spec['attr'], None) if rel_obj else None
            return label, val

        if check == 'relationship_exists':
            rel = getattr(entity, spec['rel'], None)
            if rel is None:
                return label, None
            # Dynamic relationship (lazy='dynamic') → check .first()
            if hasattr(rel, 'first'):
                return label, (True if rel.first() is not None else None)
            # List-like
            if hasattr(rel, '__len__'):
                return label, (True if len(rel) > 0 else None)
            return label, (True if rel else None)

        if check == 'bank_field':
            # Read a field from the primary (first) bank account
            bank_accounts = getattr(entity, 'bank_accounts', None)
            if bank_accounts is None:
                return label, None
            primary = bank_accounts.first() if hasattr(bank_accounts, 'first') else None
            if primary is None:
                return label, None
            val = getattr(primary, spec['attr'], None)
            return label, val

        return label, None

    @staticmethod
    def _get_field_value(entity, section, field_name):
        """Get current value of a field from an entity (used by submit/approve flows)."""
        # User-owned fields (phone_number/email/first_name/…) live on User; some
        # entities (e.g. Doctor) don't expose a read shim for them, so read the
        # source of truth directly rather than returning None.
        if field_name in USER_OWNED_FIELDS:
            user = getattr(entity, 'user', None)
            if user is not None and hasattr(user, field_name):
                val = getattr(user, field_name)
                return val.value if hasattr(val, 'value') else val

        # Direct model attributes
        if hasattr(entity, field_name):
            val = getattr(entity, field_name)
            if hasattr(val, 'value'):
                return val.value
            return val

        # JSON fields
        json_fields = ['female_health_details', 'communication_address', 'permanent_address',
                       'self_declaration_data', 'languages_known']
        for jf in json_fields:
            if hasattr(entity, jf):
                json_data = getattr(entity, jf)
                if isinstance(json_data, dict) and field_name in json_data:
                    return json_data[field_name]

        return None

    @staticmethod
    def _set_field_value(entity, section, field_name, value):
        """Set a field value on an entity after approval."""
        # first_name/dob/profile_image/... live on User and are exposed on
        # Doctor/Admin as read-only shims — write them on the source of truth.
        target = entity
        if field_name in USER_OWNED_FIELDS:
            user = getattr(entity, 'user', None)
            if user is None:
                raise ValueError(
                    f"Cannot apply '{field_name}': no linked user for this "
                    f"{type(entity).__name__}"
                )
            target = user
            # Contact fields stay unique per tenant. Re-check at APPROVE time —
            # someone else could have claimed the value between the doctor's
            # OTP-verified submit and the admin's approval.
            if field_name in ('phone_number', 'email') and value:
                from app.common.encryption import hash_for_search
                from app.models import User as _User
                col = _User._phone_hash if field_name == 'phone_number' else _User._email_hash
                clash = _User.query.filter(
                    col == hash_for_search(str(value).strip()),
                    _User.tenant_id == user.tenant_id,
                    _User.id != user.id,
                    _User.is_deleted == False,  # noqa: E712
                ).first()
                if clash:
                    label = 'phone number' if field_name == 'phone_number' else 'email'
                    raise ValueError(
                        f'Cannot approve: this {label} is now registered to another user.')

        if hasattr(target, field_name):
            # Handle enum fields
            if field_name == 'gender':
                from app.models import Gender
                try:
                    value = Gender(value) if value else None
                except (ValueError, KeyError):
                    pass
            elif field_name == 'accepting_appointments':
                from app.models import AcceptingAppointmentType
                try:
                    value = AcceptingAppointmentType(value) if value else None
                except (ValueError, KeyError):
                    pass
            setattr(target, field_name, value)
            return

        # JSON fields
        json_fields = ['female_health_details', 'communication_address', 'permanent_address',
                       'self_declaration_data', 'languages_known']
        for jf in json_fields:
            if hasattr(entity, jf):
                json_data = getattr(entity, jf) or {}
                if isinstance(json_data, dict):
                    json_data[field_name] = value
                    setattr(entity, jf, json_data)
                    return
