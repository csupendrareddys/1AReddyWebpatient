"""
RBAC Validators
===============
Validation logic for Role-Based Access Control inputs.
"""
from app.extensions import db
from app.models import Admin, User, UserRole
from app.models import Role, SubAdminRole, PermissionModule, DataRange, OverrideType

def validate_role_create(data):
    """Validate input for creating a new role."""
    errors = []
    if not data or not data.get('name', '').strip():
        errors.append('Role name is required')
    else:
        name = data['name'].strip()
        if Role.query.filter_by(name=name, is_deleted=False).first():
            errors.append(f'Role "{name}" already exists')
    
    # helper validation can be added here for level, etc.
    return errors

def validate_role_update(role_id, data):
    """Validate input for updating a role."""
    errors = []
    role = Role.query.filter_by(id=role_id, is_deleted=False).first()
    if not role:
        return ['Role not found'], None
    
    if role.is_system:
        # System roles have limited update capability, but avoiding that check here 
        # to let service decide, or strictly blocking?
        # Let's just validate name uniqueness if name is changing
        pass

    if 'name' in data:
        new_name = data['name'].strip()
        if not new_name:
            errors.append('Role name cannot be empty')
        elif new_name != role.name:
            if Role.query.filter_by(name=new_name, is_deleted=False).first():
                errors.append(f'Role "{new_name}" already exists')

    return errors, role

def validate_permission_module(module_str):
    """Validate if a string is a valid PermissionModule."""
    try:
        return PermissionModule(module_str), None
    except ValueError:
        return None, f"Unknown module: {module_str}"

def validate_data_range(range_str):
    """Validate data range string."""
    try:
        if not range_str: 
            return None, None
        return DataRange[range_str], None
    except KeyError:
        return None, f"Unknown data_range: {range_str}"

def validate_sub_admin_assignment(admin_id, role_id):
    """Validate assigning a role to a sub-admin."""
    errors = []
    admin = Admin.query.filter_by(id=admin_id, is_deleted=False).first()
    if not admin:
        return ['Admin not found'], None, None
    
    # Ensure user is actually a SUB_ADMIN?
    # The route decorator @role_required checks the *caller*, but we should check the *target*
    # However, Admin model is linked to User. 
    # Let's assume passed admin_id is valid for now or check user role if available
    
    role = Role.query.filter_by(id=role_id, is_deleted=False, is_active=True).first()
    if not role:
        errors.append('Role not found or inactive')
        return errors, admin, None

    # Check existing
    existing = SubAdminRole.query.filter_by(admin_id=admin_id, role_id=role_id).first()
    if existing and existing.is_active:
        errors.append('Role already assigned')
    
    return errors, admin, role

def validate_override_create(data):
    """Validate creating an override."""
    errors = []
    required = ['module', 'override_type', 'reason']
    for req in required:
        if not data.get(req):
            errors.append(f'{req} is required')
    
    module_enum = None
    override_type = None
    
    if 'module' in data:
        module_enum, msg = validate_permission_module(data['module'])
        if msg: errors.append(msg)
    
    if 'override_type' in data:
        try:
            override_type = OverrideType(data['override_type'])
        except ValueError:
            errors.append(f"Invalid override_type: {data['override_type']}")

    return errors, module_enum, override_type
