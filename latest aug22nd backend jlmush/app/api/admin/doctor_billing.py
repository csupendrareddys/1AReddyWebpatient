"""
Admin doctor-billing routes (Phase 2) — convert a doctor's billing type,
manage the employment agreement, and generate/settle salary payouts.

SUPER_ADMIN + SUB_ADMIN (PLATFORM_OWNER auto-passed by role_required).
Compliance is read from the reused doctor-analytics metrics.
"""
import logging
from datetime import datetime
from flask import request, Blueprint
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required, rbac_required
from app.models import PermissionModule, PermissionAction
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole, Doctor, SalaryPayout, PayoutStatus
from app.extensions import db
from app.api.common.payment import billing_service as bsvc

logger = logging.getLogger(__name__)

doctor_billing_bp = Blueprint('doctor_billing_admin', __name__)


def _get_doctor(doctor_id):
    return Doctor.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=doctor_id, is_deleted=False,
    ).first()


def _profile_payload(doctor):
    profile = bsvc.get_or_create_billing_profile(doctor)
    db.session.commit()
    agr = bsvc.get_active_agreement(doctor)
    return {
        'profile': profile.to_dict(),
        'agreement': agr.to_dict() if agr else None,
    }


def _apply_pay_overrides(doctor, data):
    """Set the doctor's per-doctor salary/retainer/second-opinion overrides."""
    keys = ('salary_override', 'retainer_override', 'second_opinion_rate_override')
    if not any(k in data for k in keys):
        return
    profile = bsvc.get_or_create_billing_profile(doctor)
    for k in keys:
        if k in data:
            v = data[k]
            setattr(profile, k, None if v in (None, '') else v)
    db.session.commit()


@doctor_billing_bp.route('/<doctor_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_doctor_billing(doctor_id):
    doctor = _get_doctor(doctor_id)
    if not doctor:
        return error_response('Doctor not found', status_code=404)
    return success_response(data=_profile_payload(doctor))


@doctor_billing_bp.route('/<doctor_id>/convert', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def convert_doctor_type(doctor_id):
    doctor = _get_doctor(doctor_id)
    if not doctor:
        return error_response('Doctor not found', status_code=404)
    data = request.get_json() or {}
    try:
        bsvc.convert_doctor(doctor, data.get('billing_type', 'plan'),
                            data.get('agreement'), actor_id=current_user.id)
        _apply_pay_overrides(doctor, data)
        return success_response(message='Billing type updated', data=_profile_payload(doctor))
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_billing_bp.route('/<doctor_id>/agreement', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def update_agreement(doctor_id):
    doctor = _get_doctor(doctor_id)
    if not doctor:
        return error_response('Doctor not found', status_code=404)
    data = request.get_json() or {}
    try:
        agr = bsvc.update_agreement(doctor, data, actor_id=current_user.id)
        return success_response(message='Agreement updated', data=agr.to_dict())
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_billing_bp.route('/<doctor_id>/salary-payouts', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def generate_salary(doctor_id):
    doctor = _get_doctor(doctor_id)
    if not doctor:
        return error_response('Doctor not found', status_code=404)
    data = request.get_json() or {}
    try:
        ps = datetime.strptime(data['period_start'], '%Y-%m-%d').date()
        pe = datetime.strptime(data['period_end'], '%Y-%m-%d').date()
    except (KeyError, ValueError):
        return error_response('period_start and period_end (YYYY-MM-DD) are required', status_code=400)
    try:
        sp = bsvc.generate_salary_payout(doctor, ps, pe, kind=data.get('kind', 'salary'))
        return success_response(message='Salary payout generated', data=sp.to_dict(), status_code=201)
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_billing_bp.route('/salary-payouts', methods=['GET'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_PAYOUT, PermissionAction.VIEW)
def list_salary_payouts():
    status = request.args.get('status')
    doctor_id = request.args.get('doctor_id')
    q = SalaryPayout.query.filter_by(tenant_id=current_tenant_id_strict())
    if status:
        try:
            q = q.filter(SalaryPayout.status == PayoutStatus(status))
        except ValueError:
            pass
    if doctor_id:
        q = q.filter(SalaryPayout.doctor_id == doctor_id)
    rows = q.order_by(SalaryPayout.created_at.desc()).all()
    out = []
    for s in rows:
        d = s.to_dict()
        if s.doctor and s.doctor.user:
            d['doctor_name'] = f"{s.doctor.user.first_name or ''} {s.doctor.user.last_name or ''}".strip()
        out.append(d)
    return success_response(data={'salary_payouts': out})


@doctor_billing_bp.route('/salary-payouts/<salary_payout_id>/adjust', methods=['POST'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_PAYOUT, PermissionAction.EDIT)
def adjust_salary_payout(salary_payout_id):
    """Record an admin correction before the payout is pushed.

    Body: { amount: signed number, kind: lwp|penalty|bonus|correction,
            reason: str (mandatory) }

    The original salary is never overwritten — the adjustment is appended and
    the net recomputed, so "expected vs approved and why" stays visible to the
    doctor forever.
    """
    sp = SalaryPayout.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=salary_payout_id,
    ).first()
    if not sp:
        return error_response('Salary payout not found', status_code=404)

    data = request.get_json() or {}
    try:
        adj = bsvc.adjust_salary_payout(
            sp,
            amount=data.get('amount'),
            kind=(data.get('kind') or 'correction'),
            reason=data.get('reason'),
            actor_id=current_user.id,
        )
    except ValueError as e:
        return error_response(str(e), status_code=400)

    return success_response(
        message=f'Adjustment recorded — payout is now {sp.net_amount}.',
        data={'adjustment': adj.to_dict(), 'salary_payout': sp.to_dict()},
        status_code=201,
    )


@doctor_billing_bp.route('/salary-payouts/<salary_payout_id>/push', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def push_salary_payout(salary_payout_id):
    """Release a salary/retainer to the doctor — WITHOUT paying it.

    The exact mirror of the per-patient ``push_payout``: ON_HOLD/PENDING →
    CLAIMABLE. The doctor's claim is what sends the money, so an admin can
    never move it — the same rule the per-patient rail already enforces.

    This is also the point after which the amount is frozen: once the doctor
    can see and claim a figure, adjusting it underneath them is not allowed.
    """
    sp = SalaryPayout.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=salary_payout_id,
    ).first()
    if not sp:
        return error_response('Salary payout not found', status_code=404)
    if sp.compliance_withheld:
        return error_response(
            'This payout is withheld for compliance — release it before pushing.',
            status_code=409,
        )
    if sp.status == PayoutStatus.CLAIMABLE:
        return error_response('This payout is already with the doctor to claim.')
    if sp.status not in (PayoutStatus.ON_HOLD, PayoutStatus.PENDING):
        return error_response(
            f'Only a held or pending payout can be pushed (this one is {sp.status.value}).',
            status_code=409,
        )

    was_held = sp.status == PayoutStatus.ON_HOLD
    sp.status = PayoutStatus.CLAIMABLE
    sp.status_reason = 'Released early by admin' if was_held else 'Released to doctor by admin'
    db.session.commit()
    logger.info('[SALARY] %s pushed to doctor by admin=%s', sp.id, current_user.id)
    return success_response(
        data=sp.to_dict(),
        message='Salary pushed to the doctor — waiting for them to collect it.',
    )


@doctor_billing_bp.route('/salary-payouts/<salary_payout_id>/status', methods=['PUT'])
@jwt_required()
@rbac_required(PermissionModule.APPROVE_PAYOUT, PermissionAction.EDIT)
def update_salary_status(salary_payout_id):
    from datetime import timezone
    sp = SalaryPayout.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=salary_payout_id,
    ).first()
    if not sp:
        return error_response('Salary payout not found', status_code=404)
    data = request.get_json() or {}
    if 'compliance_withheld' in data:
        sp.compliance_withheld = bool(data['compliance_withheld'])
    if 'status_reason' in data:
        sp.status_reason = data['status_reason']

    # Cashfree real disbursal (Phase B) — "completing" a salary/retainer payout
    # sends the money to the doctor's verified beneficiary; the payout webhook
    # confirms it. Falls back to the manual flip when Cashfree isn't configured.
    from app.api.common.payment import cashfree_payout as cf
    from app.api.common.payment import beneficiary_service as bene
    if (data.get('status') == PayoutStatus.COMPLETED.value and cf.is_configured()
            and sp.status != PayoutStatus.COMPLETED and not sp.compliance_withheld):
        from app.models import ProfileBankAccount
        bank = ProfileBankAccount.query.filter_by(
            tenant_id=sp.tenant_id, doctor_id=sp.doctor_id, order_index=0,
        ).first()
        if not bene.is_beneficiary_verified(bank):
            return error_response(
                'Doctor bank account is not a verified Cashfree beneficiary.',
                status_code=400,
            )
        tref = f"sp{sp.id.hex}"
        try:
            bene.disburse_to_bank(bank, amount=sp.net_amount, transfer_id=tref,
                                  remarks=f'{sp.kind} {sp.period_start}')
        except Exception as e:  # noqa: BLE001
            sp.status = PayoutStatus.FAILED
            sp.status_reason = f'Cashfree transfer failed: {e}'
            db.session.commit()
            return error_response(f'Cashfree transfer failed: {e}', status_code=502)
        sp.status = PayoutStatus.PROCESSING
        db.session.commit()
        return success_response(
            message='Salary sent via Cashfree — it will move to Completed on confirmation.',
            data=sp.to_dict(),
        )

    if 'status' in data:
        try:
            sp.status = PayoutStatus(data['status'])
            if sp.status == PayoutStatus.COMPLETED:
                sp.completed_at = datetime.now(timezone.utc)
        except ValueError:
            return error_response('Invalid status', status_code=400)
    db.session.commit()
    return success_response(message='Salary payout updated', data=sp.to_dict())
