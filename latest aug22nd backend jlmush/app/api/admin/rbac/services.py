"""
RBAC Services
=============
Business logic for Role-Based Access Control.
Separates database operations and complex logic from routes.
"""
import logging
from datetime import datetime
from app.extensions import db


logger = logging.getLogger(__name__)

from app.models import Admin, UserRole
from app.models import (
    Role, RolePermission, SubAdminRole, AdminPermissionOverride,
    ApprovalRequest, ApprovalAction,
    PermissionModule, DataRange, OverrideType,
    ApprovalRequestStatus, ApprovalActionType, ApprovalEntityType,
    PermissionService as Checker, utcnow
)
from app.api.admin.rbac import validators
from app.common.tenant_context import current_tenant_id_strict
from app.models.audit import create_permission_audit

class UserService:
    @staticmethod
    def get_admin(admin_id):
        return Admin.query.filter_by(
            id=admin_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
        ).first()

class RoleService:
    @staticmethod
    def list_roles(page, per_page, search, include_inactive):
        query = Role.query.filter_by(
            tenant_id=current_tenant_id_strict(), is_deleted=False,
        )
        if not include_inactive:
            query = query.filter_by(is_active=True)
        if search:
            query = query.filter(Role.name.ilike(f'%{search}%'))
        return query.order_by(Role.level.asc().nullslast(), Role.name.asc()).paginate(
            page=page, per_page=per_page, error_out=False)

    @staticmethod
    def create_role(data, created_by_id):
        errors = validators.validate_role_create(data)
        if errors:
            raise ValueError(errors[0])

        # tenant_id is auto-filled from ``g.tenant_id`` by the
        # before_flush hook in app/models/_base.py. Keep this site
        # documented so that if anyone ever wires a "platform owner
        # creates a role on tenant X" cross-tenant flow they remember
        # to pass tenant_id=target_tenant_id explicitly here (the
        # hook only fills when the value is None and won't overwrite
        # an explicit assignment).
        role = Role(
            name=data['name'].strip(),
            description=data.get('description', ''),
            level=data.get('level'),
            is_system=False,
            created_by_id=created_by_id
        )
        db.session.add(role)
        db.session.commit()
        return role

    @staticmethod
    def update_role(role_id, data):
        role = Role.query.filter_by(id=role_id, is_deleted=False).first()
        if not role:
            raise LookupError('Role not found')
        
        # System role check is done in route usually for failing fast with 403, 
        # but good to have here too
        if role.is_system:
            # We allow description updates for system roles? Maybe not.
            # Route logic blocked everything.
            raise PermissionError('System roles cannot be modified')

        if 'name' in data:
            new_name = data['name'].strip()
            if new_name != role.name:
                if Role.query.filter_by(name=new_name, is_deleted=False).first():
                    raise ValueError(f'Role "{new_name}" already exists')
                role.name = new_name
        
        if 'description' in data: role.description = data['description']
        if 'level' in data: role.level = data['level']
        if 'is_active' in data: role.is_active = data['is_active']
        
        db.session.commit()
        return role

    @staticmethod
    def delete_role(role_id):
        role = Role.query.filter_by(id=role_id, is_deleted=False).first()
        if not role:
            raise LookupError('Role not found')
        if role.is_system:
            raise PermissionError('System roles cannot be deleted')
        
        active_users = role.sub_admin_assignments.filter_by(is_active=True).count()
        if active_users > 0:
            raise ValueError(f'Cannot delete: {active_users} sub-admin(s) still assigned')
            
        role.is_deleted = True
        role.is_active = False
        role.deleted_at = utcnow()
        db.session.commit()
        return role

# ── Per-tenant module catalog ────────────────────────────────────────────
# The vendor tenant and customer tenants manage DIFFERENT things: the
# vendor's staff run tenants/plans/billing and its marketing site — it
# has no patients or doctors — while a customer tenant has the whole
# product surface and no business touching the vendor console. Serving
# one union matrix is how the SaaS seller's Roles page came to offer
# "Patient Login Page". These sets scope both what the matrix RENDERS
# and what the write paths ACCEPT.

# Exists only on the vendor console.
_VENDOR_ONLY_MODULES = frozenset({
    PermissionModule.TENANT_MANAGEMENT,
    PermissionModule.TENANT_PERMISSIONS,
    PermissionModule.PLAN_CATALOG,
    PermissionModule.PLAN_SUBSCRIPTION,
    PermissionModule.ADDON_CATALOG,
})

# Surfaces both sides genuinely have: their own staff/roles, their own
# landing site, their own audit trail.
_SHARED_MODULES = frozenset({
    PermissionModule.ADMIN_LIST, PermissionModule.ADMIN_ROLES,
    PermissionModule.ADMIN_PERMISSIONS,
    PermissionModule.SUB_ADMIN_MANAGEMENT,
    PermissionModule.SYSTEM_SETTINGS, PermissionModule.AUDIT_LOGS,
    PermissionModule.SUPPORT_CHAT,
    PermissionModule.LANDING_HERO, PermissionModule.LANDING_NAV,
    PermissionModule.LANDING_FEATURES, PermissionModule.LANDING_CONFIG,
    PermissionModule.LANDING_MODULE,
})


def modules_for_tenant(tenant_id):
    """The PermissionModule set a tenant's roles may grant."""
    from app.models import Tenant
    tenant = Tenant.query.filter_by(id=tenant_id).first()
    if tenant is not None and tenant.is_platform:
        return _VENDOR_ONLY_MODULES | _SHARED_MODULES
    return frozenset(PermissionModule) - _VENDOR_ONLY_MODULES


class PermissionManagementService:
    @staticmethod
    def get_role_matrix(role_id):
        role = Role.query.filter_by(id=role_id, is_deleted=False).first()
        if not role:
            raise LookupError('Role not found')

        allowed = modules_for_tenant(role.tenant_id)
        permissions = [p for p in role.permissions.filter_by(is_active=True)
                       if p.module in allowed]
        matrix = {}
        # Default restricted state
        for mod in sorted(allowed, key=lambda m: list(PermissionModule).index(m)):
            matrix[mod.value] = {
                'module': mod.value, 'full_access': False, 'can_view': False,
                'can_create': False, 'can_edit': False, 'can_update': False,
                'can_delete': False, 'can_l1_verify': False, 'can_l2_verify': False,
                'can_l3_verify': False, 'can_lock': False, 'can_unlock': False,
                'data_range': DataRange.ALL.name, 'data_range_label': DataRange.ALL.label,
            }
        for perm in permissions:
            matrix[perm.module.value] = perm.to_dict()
        return role, list(matrix.values())

    @staticmethod
    def bulk_update(role_id, permissions_data, user_id):
        role = Role.query.filter_by(id=role_id, is_deleted=False).first()
        if not role:
            raise LookupError('Role not found')

        allowed = modules_for_tenant(role.tenant_id)
        warnings = []
        for p_data in permissions_data:
            mod_str = p_data.get('module')
            try:
                mod_enum = PermissionModule(mod_str)
            except ValueError:
                warnings.append(f'Unknown module: {mod_str}')
                continue
            if mod_enum not in allowed:
                warnings.append(
                    f'Module not available to this organisation: {mod_str}')
                continue

            resource_id = p_data.get('resource_id') or None
            perm = RolePermission.query.filter_by(
                role_id=role.id, module=mod_enum, resource_id=resource_id,
            ).first()
            if not perm:
                perm = RolePermission(role_id=role.id, module=mod_enum, resource_id=resource_id)
                db.session.add(perm)
                db.session.flush() # Ensure ID is generated for audit log
                before = None
                action = 'create'
            else:
                before = perm.to_dict()
                action = 'update'
            
            # Update fields
            fields = ['full_access', 'can_view', 'can_create', 'can_edit', 'can_update',
                      'can_delete', 'can_l1_verify', 'can_l2_verify', 'can_l3_verify', 
                      'can_lock', 'can_unlock']
            for f in fields:
                if f in p_data: setattr(perm, f, p_data[f])
            
            if 'data_range' in p_data:
                try:
                    perm.data_range = DataRange[p_data['data_range']]
                except KeyError:
                    warnings.append(f'Unknown data_range: {p_data["data_range"]}')
            
            if 'field_restrictions' in p_data:
                perm.field_restrictions = p_data['field_restrictions']


            perm.is_active = True
            
            is_valid, dep_warnings = perm.validate_dependencies()
            if dep_warnings:
                warnings.extend([f'{mod_str}: {w}' for w in dep_warnings])
            
            create_permission_audit(perm, action, user_id, before, reason='Bulk update')
        
        db.session.commit()
        return role, warnings

    @staticmethod
    def update_single(role_id, module_str, data, user_id):
        role = Role.query.filter_by(id=role_id, is_deleted=False).first()
        if not role: raise LookupError('Role not found')
        try:
            mod_enum = PermissionModule(module_str)
        except ValueError:
            raise ValueError(f'Unknown module: {module_str}')
        if mod_enum not in modules_for_tenant(role.tenant_id):
            raise ValueError(
                f'Module not available to this organisation: {module_str}')

        resource_id = data.get('resource_id') or None
        perm = RolePermission.query.filter_by(
            role_id=role.id, module=mod_enum, resource_id=resource_id,
        ).first()
        if not perm:
            perm = RolePermission(role_id=role.id, module=mod_enum, resource_id=resource_id)
            db.session.add(perm)
            db.session.flush() # Ensure ID is generated for audit log
            before = None
            action = 'create'
        else:
            before = perm.to_dict()
            action = 'update'
        
        fields = ['full_access', 'can_view', 'can_create', 'can_edit', 'can_update',
                  'can_delete', 'can_l1_verify', 'can_l2_verify', 'can_l3_verify', 
                  'can_lock', 'can_unlock']
        for f in fields:
            if f in data: setattr(perm, f, data[f])
            
        if 'data_range' in data:
            try:
                perm.data_range = DataRange[data['data_range']]
            except KeyError:
                raise ValueError(f'Unknown data_range: {data["data_range"]}')
        
        if 'field_restrictions' in data:
            perm.field_restrictions = data['field_restrictions']
            

        perm.is_active = True
        
        _, warnings = perm.validate_dependencies()
        create_permission_audit(perm, action, user_id, before, reason='Single update')
        
        db.session.commit()
        return perm, warnings

    @staticmethod
    def kill_switch_revoke(role_id, module_str, actions, user_id, resource_id=None):
        role = Role.query.filter_by(id=role_id, is_deleted=False).first()
        if not role: raise LookupError('Role not found')
        try:
            mod_enum = PermissionModule(module_str)
        except ValueError: raise ValueError(f'Unknown module: {module_str}')

        perm = RolePermission.query.filter_by(
            role_id=role.id, module=mod_enum, resource_id=resource_id,
        ).first()
        if not perm: raise LookupError('Permission not found')
        
        before = perm.to_dict()
        
        if actions:
            # Revoke specific
            mapping = {
                'view': 'can_view', 'create': 'can_create', 'edit': 'can_edit',
                'update': 'can_update', 'delete': 'can_delete',
                'l1_verifier': 'can_l1_verify', 'l2_verifier': 'can_l2_verify',
                'l3_verifier': 'can_l3_verify', 'lock': 'can_lock', 'unlock': 'can_unlock',
                'full_access': 'full_access'
            }
            for a in actions:
                f = mapping.get(a)
                if f: setattr(perm, f, False)
        else:
            # Revoke all
            perm.full_access = False
            perm.can_view = perm.can_create = perm.can_edit = False
            perm.can_update = perm.can_delete = False
            perm.can_l1_verify = perm.can_l2_verify = perm.can_l3_verify = False
            perm.can_lock = perm.can_unlock = False
            

        create_permission_audit(perm, 'revoke', user_id, before, 
                                reason=f"Revoke: {actions or 'ALL'}")
        db.session.commit()
        return perm

class SubAdminService:
    @staticmethod
    def assign_role(admin_id, role_id, user_id):
        admin = Admin.query.filter_by(id=admin_id, is_deleted=False).first()
        if not admin: raise LookupError('Admin not found')
        
        role = Role.query.filter_by(id=role_id, is_deleted=False, is_active=True).first()
        if not role: raise LookupError('Role not found or inactive')
        
        existing = SubAdminRole.query.filter_by(admin_id=admin_id, role_id=role.id).first()
        if existing:
            if existing.is_active:
                 raise ValueError('Role already assigned')
            existing.is_active = True
            existing.assigned_by_id = user_id
            existing.deactivated_at = None
            db.session.commit()
            return existing, False # False = updated
        
        assignment = SubAdminRole(admin_id=admin_id, role_id=role.id, assigned_by_id=user_id)
        db.session.add(assignment)
        db.session.commit()
        return assignment, True # True = created

    @staticmethod
    def revoke_assignment(admin_id, role_id, user_id):
        assignment = SubAdminRole.query.filter_by(
            admin_id=admin_id, role_id=role_id, is_active=True).first()
        if not assignment:
            raise LookupError('Assignment not found')
            
        assignment.is_active = False
        assignment.deactivated_at = utcnow()
        db.session.commit()
        return assignment

class OverrideService:
    @staticmethod
    def create_override(admin_id, data, user_id):
        errors, module, override_type = validators.validate_override_create(data)
        if errors:
            raise ValueError(errors[0])
            
        # One active override per (admin, module, resource_id). Module-wide
        # (resource_id=NULL) and per-instance rows can coexist, but within each
        # scope only one active override is allowed to avoid conflicts.
        resource_id = data.get('resource_id') or None
        existing = AdminPermissionOverride.query.filter_by(
            admin_id=admin_id, module=module, resource_id=resource_id, is_active=True,
        ).first()

        if existing:
            scope_label = f" (instance {resource_id})" if resource_id else ""
            raise ValueError(
                f"An active override for module '{module.value}'{scope_label} already exists. "
                f"Please edit or deactivate it."
            )

        override = AdminPermissionOverride(
            admin_id=admin_id, module=module, resource_id=resource_id,
            override_type=override_type,
            reason=data['reason'].strip(), created_by_id=user_id,
        )
        fields = ['full_access', 'can_view', 'can_create', 'can_edit', 'can_update',
                  'can_delete', 'can_l1_verify', 'can_l2_verify', 'can_l3_verify',
                  'can_lock', 'can_unlock']
        for f in fields:
            if f in data: setattr(override, f, data[f])
            
        if data.get('data_range'):
            override.data_range = DataRange[data['data_range']]
            
        if data.get('expires_at'):
             override.expires_at = datetime.fromisoformat(data['expires_at'].replace('Z', '+00:00'))
             
        db.session.add(override)
        db.session.commit()
        return override

    @staticmethod
    def update_override(override_id, data):
        override = AdminPermissionOverride.query.filter_by(id=override_id, is_active=True).first()
        if not override: raise LookupError('Override not found')
        
        fields = ['full_access', 'can_view', 'can_create', 'can_edit', 'can_update',
                  'can_delete', 'can_l1_verify', 'can_l2_verify', 'can_l3_verify',
                  'can_lock', 'can_unlock', 'reason']
        for f in fields:
            if f in data: setattr(override, f, data[f])
            
        if 'expires_at' in data:
            if data['expires_at']:
                override.expires_at = datetime.fromisoformat(data['expires_at'].replace('Z', '+00:00'))
            else:
                override.expires_at = None
                
        db.session.commit()
        return override

    @staticmethod
    def deactivate_override(override_id):
        override = AdminPermissionOverride.query.filter_by(id=override_id, is_active=True).first()
        if not override: raise LookupError('Override not found')
        override.deactivate()
        db.session.commit()
        return override

class ApprovalService:
    @staticmethod
    def list_approvals(page, per_page, status=None, entity_type=None):
        query = ApprovalRequest.query.filter_by(tenant_id=current_tenant_id_strict())

        if status:
            query = query.filter_by(status=ApprovalRequestStatus(status))
        if entity_type:
            query = query.filter_by(entity_type=ApprovalEntityType(entity_type))

        pagination = query.order_by(ApprovalRequest.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )
        return pagination

    @staticmethod
    def apply_doctor_availability_sync(approval, admin_id):
        """Mirror an approval into the Doctor row + materialise TimeSlot.

        Two endpoints approve doctor-availability requests:
          * /api/admin/rbac/approvals/<id>/approve  (generic approvals)
          * /api/admin/availability-approvals/<id>/approve  (doctor-availability admin UI)

        Both ultimately call ``ApprovalService.process_action`` to mark
        the request COMPLETED — but the doctor-side updates
        (``approved_working_days`` / ``approved_slot_pricing`` /
        ``availability_config`` mutations + flipping
        ``availability_approval_status`` to APPROVED + re-materialising
        ``time_slots`` from the freshly-approved ``day_overrides``)
        were duplicated inline in only the first route. Approving via
        the second route marked the request COMPLETED but the doctor
        row stayed at ``availability_approval_status='pending'`` —
        which the patient-facing slot endpoint hard-gates on, so
        approved slots never became bookable.

        This helper is the single source of truth for that mirroring.
        Both routes call it after ``process_action`` returns COMPLETED.
        Idempotent — re-running on an already-applied approval is safe.

        Args:
            approval: the ApprovalRequest just processed.
            admin_id: the User.id of the admin who approved.

        Returns:
            None. Mutates + commits the Doctor row in place.

        Errors are logged + rolled back but never re-raised — the
        approval itself committed earlier in ``process_action``, and
        rolling back the doctor-side changes leaves a recoverable
        state (operator can re-approve to retry).
        """
        from app.models import (
            ApprovalEntityType, ApprovalRequestStatus,
            AvailabilityApprovalStatus, Doctor,
        )
        from datetime import datetime, timezone as tz
        from sqlalchemy.orm.attributes import flag_modified

        AVAILABILITY_TYPES = (
            ApprovalEntityType.DOCTOR_AVAILABILITY,
            ApprovalEntityType.DOCTOR_FEE,
        )
        if approval.entity_type not in AVAILABILITY_TYPES:
            return
        if approval.status != ApprovalRequestStatus.COMPLETED:
            return

        try:
            doctor = Doctor.query.filter_by(
                id=approval.entity_id, is_deleted=False,
            ).first()
            if not doctor:
                # Cross-tenant lookup hidden by RLS, or doctor deleted.
                # Approval row already COMPLETED — skip the mirror.
                return

            from app.models import ApprovalRequest
            from app.api.common.timeslot.slot_approval import (
                find_slot_by_id, set_status, APPROVAL_STATUS_APPROVED,
            )

            def _mark_live_slot_approved(section, keys, slot_id):
                """Flip the matching live draft slot's status to approved (cosmetic
                — patient visibility follows the approved snapshot). *keys* walks
                into availability_config[section] to reach the slot list."""
                cfg = doctor.availability_config or {}
                node = cfg.get(section, {}) or {}
                parent = node
                for k in keys[:-1]:
                    parent = parent.get(k, {}) or {}
                live_list = parent.get(keys[-1], []) if keys else []
                _, lslot = find_slot_by_id(live_list, slot_id)
                if lslot is not None:
                    set_status(lslot, APPROVAL_STATUS_APPROVED)
                    doctor.availability_config = cfg
                    flag_modified(doctor, 'availability_config')

            meta = approval.changes.get('_meta') if approval.changes else None
            if meta:
                cat = meta.get('category')
                typ = meta.get('type')
                slot_id = meta.get('slot_id')
                app_data = approval.changes.get('data')
                deleted = isinstance(app_data, dict) and app_data.get('_deleted')

                if cat == 'pricing' and app_data is not None:
                    curr_pricing = []
                    if doctor.approved_slot_pricing:
                        curr_pricing = [
                            p for p in doctor.approved_slot_pricing
                            if p.get('consultation_type', 'complete') != typ
                        ]
                    curr_pricing.extend(app_data)
                    doctor.approved_slot_pricing = curr_pricing
                    flag_modified(doctor, 'approved_slot_pricing')

                elif cat == 'working_hours' and slot_id:
                    # Per-slot: upsert/remove one slot in approved_working_days.
                    day = meta.get('day')
                    curr_wh = dict(doctor.approved_working_days or {})
                    if typ == 'global':
                        day_list = list(curr_wh.get(day, []) or [])
                    else:
                        type_map = dict(curr_wh.get(typ, {}) or {})
                        day_list = list(type_map.get(day, []) or [])
                    idx, _existing = find_slot_by_id(day_list, slot_id)
                    if deleted:
                        if idx is not None:
                            day_list.pop(idx)
                    else:
                        new_slot = set_status(dict(app_data), APPROVAL_STATUS_APPROVED)
                        if idx is not None:
                            day_list[idx] = new_slot
                        else:
                            day_list.append(new_slot)
                    if typ == 'global':
                        if day_list:
                            curr_wh[day] = day_list
                        else:
                            curr_wh.pop(day, None)
                    else:
                        if day_list:
                            type_map[day] = day_list
                        else:
                            type_map.pop(day, None)
                        curr_wh[typ] = type_map
                    doctor.approved_working_days = curr_wh
                    flag_modified(doctor, 'approved_working_days')
                    if not deleted:
                        wh_keys = [day] if typ == 'global' else [typ, day]
                        _mark_live_slot_approved('working_days', wh_keys, slot_id)

                elif cat == 'working_hours' and app_data is not None:
                    # Legacy whole-slice fallback (pre per-slot requests).
                    curr_wh = dict(doctor.approved_working_days or {})
                    if typ == 'global':
                        curr_wh = app_data
                    else:
                        curr_wh[typ] = app_data
                    doctor.approved_working_days = curr_wh
                    flag_modified(doctor, 'approved_working_days')

                elif cat == 'calendar' and slot_id:
                    # Per-slot: upsert/remove one dated slot in approved_day_overrides.
                    date_str = meta.get('date')
                    curr_do = dict(doctor.approved_day_overrides or {})
                    day_list = list(curr_do.get(date_str, []) or [])
                    idx, _existing = find_slot_by_id(day_list, slot_id)
                    if deleted:
                        if idx is not None:
                            day_list.pop(idx)
                    else:
                        new_slot = set_status(dict(app_data), APPROVAL_STATUS_APPROVED)
                        if idx is not None:
                            day_list[idx] = new_slot
                        else:
                            day_list.append(new_slot)
                    # Keep the date key even when empty — an empty list means
                    # "day blocked", which materialize_day_overrides honours by
                    # deleting that date's unbooked slots.
                    curr_do[date_str] = day_list
                    doctor.approved_day_overrides = curr_do
                    flag_modified(doctor, 'approved_day_overrides')
                    if not deleted:
                        _mark_live_slot_approved('day_overrides', [date_str], slot_id)

                elif cat == 'calendar' and app_data is not None:
                    # Legacy whole-slice fallback → approved snapshot.
                    doctor.approved_day_overrides = app_data
                    flag_modified(doctor, 'approved_day_overrides')

                elif cat == 'global_config' and app_data is not None:
                    curr_tgt = {} if not doctor.availability_config else doctor.availability_config
                    curr_tgt.update(app_data)
                    doctor.availability_config = curr_tgt
                    flag_modified(doctor, 'availability_config')
            else:
                # Legacy monolithic request — no _meta. Fallback: copy
                # the doctor's draft schedule onto the approved snapshot.
                doctor.approved_slot_pricing = doctor.slot_pricing
                doctor.approved_working_days = (
                    doctor.availability_config or {}
                ).get('working_days', {})
                doctor.approved_day_overrides = (
                    doctor.availability_config or {}
                ).get('day_overrides', {})

            # Recompute the doctor-wide rollup flag (informational — no longer a
            # visibility gate). APPROVED only once no availability/fee request is
            # still open, so approving one slot doesn't falsely mark the whole
            # doctor approved while siblings remain pending.
            still_pending = ApprovalRequest.query.filter(
                ApprovalRequest.entity_id == doctor.id,
                ApprovalRequest.entity_type.in_(AVAILABILITY_TYPES),
                ApprovalRequest.status == ApprovalRequestStatus.PENDING,
            ).count()
            if still_pending:
                doctor.availability_approval_status = AvailabilityApprovalStatus.PENDING
            else:
                doctor.availability_approval_status = AvailabilityApprovalStatus.APPROVED
                doctor.availability_approved_at = datetime.now(tz.utc)
                doctor.availability_approved_by_id = admin_id
                doctor.availability_rejection_reason = None
            db.session.commit()
            logger.info(
                "[APPROVE] Doctor %s slot approved (meta=%s); rollup=%s, pending=%d",
                doctor.id, meta, doctor.availability_approval_status, still_pending,
            )

            # Re-materialise TimeSlot rows from the APPROVED day_overrides only.
            # Idempotent upsert by (doctor_id, date, start_time).
            try:
                from app.api.common.timeslot.service import TimeSlotService
                TimeSlotService.materialize_day_overrides(
                    doctor.id, doctor.approved_day_overrides or {},
                )
                db.session.commit()
            except Exception as ms_err:  # noqa: BLE001
                logger.warning(
                    "[APPROVE] time_slots re-materialise failed "
                    "for doctor=%s: %s", doctor.id, ms_err,
                    exc_info=True,
                )
        except Exception as sync_err:  # noqa: BLE001
            logger.warning(
                "[APPROVE] doctor-sync failed for approval %s: %s",
                approval.id, sync_err, exc_info=True,
            )
            db.session.rollback()

    @staticmethod
    def apply_doctor_availability_reject(approval, admin_id):
        """Mirror a per-slot rejection onto the doctor's live draft.

        Marks the rejected slot ``approval_status='rejected'`` in
        ``availability_config`` (so the doctor sees it and it isn't
        auto-resubmitted on the next save) WITHOUT touching the approved
        snapshot — any previously-approved version of that slot stays
        bookable. Recomputes the informational rollup flag. Idempotent;
        errors are logged and rolled back, never re-raised.
        """
        from app.models import (
            ApprovalEntityType, ApprovalRequestStatus,
            AvailabilityApprovalStatus, Doctor, ApprovalRequest,
        )
        from sqlalchemy.orm.attributes import flag_modified

        AVAILABILITY_TYPES = (
            ApprovalEntityType.DOCTOR_AVAILABILITY,
            ApprovalEntityType.DOCTOR_FEE,
        )
        if approval.entity_type not in AVAILABILITY_TYPES:
            return
        if approval.status != ApprovalRequestStatus.REJECTED:
            return

        try:
            doctor = Doctor.query.filter_by(
                id=approval.entity_id, is_deleted=False,
            ).first()
            if not doctor:
                return

            from app.api.common.timeslot.slot_approval import (
                find_slot_by_id, set_status, APPROVAL_STATUS_REJECTED,
            )
            meta = approval.changes.get('_meta') if approval.changes else None
            slot_id = meta.get('slot_id') if meta else None
            if meta and slot_id:
                cat = meta.get('category')
                typ = meta.get('type')
                cfg = doctor.availability_config or {}
                live_list = None
                if cat == 'working_hours':
                    wd = cfg.get('working_days', {}) or {}
                    if typ == 'global':
                        live_list = wd.get(meta.get('day'), [])
                    else:
                        live_list = (wd.get(typ, {}) or {}).get(meta.get('day'), [])
                elif cat == 'calendar':
                    live_list = (cfg.get('day_overrides', {}) or {}).get(meta.get('date'), [])
                if live_list is not None:
                    _, lslot = find_slot_by_id(live_list, slot_id)
                    if lslot is not None:
                        set_status(lslot, APPROVAL_STATUS_REJECTED)
                        doctor.availability_config = cfg
                        flag_modified(doctor, 'availability_config')

            still_pending = ApprovalRequest.query.filter(
                ApprovalRequest.entity_id == doctor.id,
                ApprovalRequest.entity_type.in_(AVAILABILITY_TYPES),
                ApprovalRequest.status == ApprovalRequestStatus.PENDING,
            ).count()
            doctor.availability_approval_status = (
                AvailabilityApprovalStatus.PENDING if still_pending
                else AvailabilityApprovalStatus.APPROVED
            )
            db.session.commit()
        except Exception as rej_err:  # noqa: BLE001
            logger.warning(
                "[REJECT] doctor-sync failed for approval %s: %s",
                approval.id, rej_err, exc_info=True,
            )
            db.session.rollback()

    @staticmethod
    def process_action(request_id, action_type, user_id, comments=''):
        approval = ApprovalRequest.query.filter_by(id=request_id).first()
        if not approval: raise LookupError('Approval request not found')
        
        if action_type == 'approve':
            success, msg = approval.approve_level(admin_id=user_id, comments=comments)
            if not success: raise ValueError(msg)
        elif action_type == 'reject':
             if approval.status in (ApprovalRequestStatus.COMPLETED, ApprovalRequestStatus.REJECTED):
                 raise ValueError(f'Cannot reject in status: {approval.status.value}')
             approval.status = ApprovalRequestStatus.REJECTED
             approval.completed_at = utcnow()
             # ``tenant_id=approval.tenant_id`` mirrors the same fix
             # made in ``ApprovalRequest.approve_level``. ApprovalAction
             # inherits TenantMixin (NOT NULL tenant_id) and the ORM
             # won't auto-fill it — leaving it unset 500s the request
             # with NotNullViolation when PLATFORM_OWNER approves
             # cross-tenant.
             db.session.add(ApprovalAction(
                 tenant_id=approval.tenant_id,
                 request_id=approval.id, admin_id=user_id,
                 action=ApprovalActionType.REJECT,
                 level=approval.current_level + 1, comments=comments,
             ))
        elif action_type == 'cancel':
             if approval.status in (ApprovalRequestStatus.COMPLETED, ApprovalRequestStatus.REJECTED):
                 raise ValueError(f'Cannot cancel in status: {approval.status.value}')
             approval.status = ApprovalRequestStatus.REJECTED
             approval.completed_at = utcnow()
             db.session.add(ApprovalAction(
                 tenant_id=approval.tenant_id,
                 request_id=approval.id, admin_id=user_id,
                 action=ApprovalActionType.CANCEL,
                 level=approval.current_level, comments=comments,
             ))
                                          
        db.session.commit()
        return approval

class AuditService:
    @staticmethod
    def list_logs(page, per_page, filters):
        # Implementation moved from route
        from app.models.audit import RolePermissionAuditLog
        query = RolePermissionAuditLog.query
        if filters.get('role_id'):
            query = query.filter_by(role_id=filters['role_id'])
        if filters.get('module'):
            query = query.filter_by(module=PermissionModule(filters['module']))
        if filters.get('action'):
            query = query.filter_by(action=filters['action'])
        if filters.get('changed_by_id'):
            query = query.filter_by(changed_by_id=filters['changed_by_id'])
            
        return query.order_by(RolePermissionAuditLog.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False)
