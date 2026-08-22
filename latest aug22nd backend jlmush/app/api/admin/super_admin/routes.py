"""
Super Admin Routes
API endpoints for super admin operations - admin management.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, current_user
from marshmallow import ValidationError

from app.common.decorators import role_required, feature_required
from app.models import UserRole

from .service import SuperAdminService
from .validators import CreateAdminSchema, UpdateAdminSchema, AdminStatusSchema


super_admin_bp = Blueprint('super_admin', __name__)


# --- Admin Management ---

@super_admin_bp.route('/admins', methods=['POST'])
@jwt_required()
@feature_required('admin.manage_users')
@role_required(UserRole.SUPER_ADMIN)
def create_admin():
    """
    Create a new admin (super_admin or sub_admin).
    Only super admins can create other admins.
    This is test
    Request Body:
        {
            "email": "admin@example.com",  // optional
            "phone_number": "9876543210",
            "password": "SecurePass123!",
            "first_name": "John",
            "middle_name": "M",  // optional
            "last_name": "Doe",
            "role": "sub_admin",  // or "super_admin"
            "permissions": ["view_patients", "view_appointments"]  // for sub_admin
        }
    
    Returns:
        201: Admin created successfully
        400: Validation error
        409: User already exists
    """
    from app.api.pricing.service import PlanLimitExceeded
    try:
        # Validate input
        schema = CreateAdminSchema()
        data = schema.load(request.get_json())

        # Create admin
        user, admin = SuperAdminService.create_admin(data, created_by_user=current_user)

        return jsonify({
            'success': True,
            'message': f'{data.get("role", "sub_admin").replace("_", " ").title()} created successfully',
            'data': {
                'admin': admin.to_dict(include_user=True),
            }
        }), 201

    except ValidationError as e:
        return jsonify({
            'success': False,
            'error': 'Validation error',
            'details': e.messages
        }), 400
    except PlanLimitExceeded as e:
        return jsonify({
            'success': False,
            'error': 'plan_limit_exceeded',
            'limit': e.limit,
            'current': e.current,
            'max': e.max_allowed,
        }), 402
    except ValueError as e:
        # Check if it's a duplicate error
        error_msg = str(e)
        if 'already exists' in error_msg:
            return jsonify({
                'success': False,
                'error': 'Conflict',
                'message': error_msg
            }), 409
        return jsonify({
            'success': False,
            'error': 'Validation error',
            'message': error_msg
        }), 400


@super_admin_bp.route('/admins', methods=['GET'])
@jwt_required()
@feature_required('admin.manage_users')
@role_required(UserRole.SUPER_ADMIN)
def list_admins():
    """
    List all admins with pagination and filters.
    
    Query Parameters:
        - page: Page number (default: 1)
        - per_page: Items per page (default: 20, max: 100)
        - role: Filter by role ('super_admin' or 'sub_admin')
        - status: Filter by status ('active', 'blocked', etc.)
        - include_deleted: Include soft-deleted admins (default: false)
    
    Returns:
        200: List of admins with pagination info
    """
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', 20, type=int), 100)
    role_filter = request.args.get('role')
    status_filter = request.args.get('status')
    include_deleted = request.args.get('include_deleted', 'false').lower() == 'true'
    
    pagination = SuperAdminService.list_admins(
        page=page,
        per_page=per_page,
        role_filter=role_filter,
        status_filter=status_filter,
        include_deleted=include_deleted
    )
    
    return jsonify({
        'success': True,
        'data': {
            'admins': [admin.to_dict(include_user=True) for admin in pagination.items],
            'pagination': {
                'page': pagination.page,
                'per_page': pagination.per_page,
                'total': pagination.total,
                'pages': pagination.pages,
                'has_next': pagination.has_next,
                'has_prev': pagination.has_prev
            }
        }
    }), 200


@super_admin_bp.route('/admins/<admin_id>', methods=['GET'])
@jwt_required()
@feature_required('admin.manage_users')
@role_required(UserRole.SUPER_ADMIN)
def get_admin(admin_id):
    """
    Get admin details by ID.
    
    Path Parameters:
        admin_id: Admin UUID
    
    Returns:
        200: Admin details
        404: Admin not found
    """
    admin = SuperAdminService.get_admin(admin_id)
    
    if not admin:
        return jsonify({
            'success': False,
            'error': 'Not found',
            'message': 'Admin not found'
        }), 404
    
    return jsonify({
        'success': True,
        'data': {
            'admin': admin.to_dict(include_user=True)
        }
    }), 200


@super_admin_bp.route('/admins/<admin_id>', methods=['PUT'])
@jwt_required()
@feature_required('admin.manage_users')
@role_required(UserRole.SUPER_ADMIN)
def update_admin(admin_id):
    """
    Update admin details and permissions.
    
    Path Parameters:
        admin_id: Admin UUID
    
    Request Body:
        {
            "first_name": "John",  // optional
            "middle_name": "M",  // optional
            "last_name": "Doe",  // optional
            "permissions": ["view_patients", "view_doctors"]  // optional, for sub_admin
        }
    
    Returns:
        200: Admin updated successfully
        400: Validation error
        404: Admin not found
    """
    admin = SuperAdminService.get_admin(admin_id)
    
    if not admin:
        return jsonify({
            'success': False,
            'error': 'Not found',
            'message': 'Admin not found'
        }), 404
    
    try:
        # Validate input
        schema = UpdateAdminSchema()
        data = schema.load(request.get_json())
        
        # Update admin
        updated_admin = SuperAdminService.update_admin(admin, data)
        
        return jsonify({
            'success': True,
            'message': 'Admin updated successfully',
            'data': {
                'admin': updated_admin.to_dict(include_user=True)
            }
        }), 200
        
    except ValidationError as e:
        return jsonify({
            'success': False,
            'error': 'Validation error',
            'details': e.messages
        }), 400
    except ValueError as e:
        return jsonify({
            'success': False,
            'error': 'Validation error',
            'message': str(e)
        }), 400


@super_admin_bp.route('/admins/<admin_id>', methods=['DELETE'])
@jwt_required()
@feature_required('admin.manage_users')
@role_required(UserRole.SUPER_ADMIN)
def delete_admin(admin_id):
    """
    Soft-delete an admin.
    
    Path Parameters:
        admin_id: Admin UUID
    
    Query Parameters:
        - hard: If 'true', permanently delete (default: false)
    
    Returns:
        200: Admin deleted successfully
        404: Admin not found
        400: Cannot delete yourself
    """
    admin = SuperAdminService.get_admin(admin_id)
    
    if not admin:
        return jsonify({
            'success': False,
            'error': 'Not found',
            'message': 'Admin not found'
        }), 404
    
    # Prevent self-deletion
    if admin.user_id == current_user.id:
        return jsonify({
            'success': False,
            'error': 'Bad request',
            'message': 'Cannot delete your own account'
        }), 400
    
    hard_delete = request.args.get('hard', 'false').lower() == 'true'
    SuperAdminService.delete_admin(admin, hard_delete=hard_delete)
    
    return jsonify({
        'success': True,
        'message': 'Admin deleted successfully'
    }), 200


@super_admin_bp.route('/admins/<admin_id>/status', methods=['PUT'])
@jwt_required()
@feature_required('admin.manage_users')
@role_required(UserRole.SUPER_ADMIN)
def update_admin_status(admin_id):
    """
    Update admin status (activate/block/etc.).
    
    Path Parameters:
        admin_id: Admin UUID
    
    Request Body:
        {
            "status": "active"  // or "blocked", "inactive"
        }
    
    Returns:
        200: Status updated successfully
        400: Validation error
        404: Admin not found
    """
    admin = SuperAdminService.get_admin(admin_id)
    
    if not admin:
        return jsonify({
            'success': False,
            'error': 'Not found',
            'message': 'Admin not found'
        }), 404
    
    # Prevent self-blocking
    if admin.user_id == current_user.id:
        return jsonify({
            'success': False,
            'error': 'Bad request',
            'message': 'Cannot change your own status'
        }), 400
    
    try:
        # Validate input
        schema = AdminStatusSchema()
        data = schema.load(request.get_json())
        
        # Update status
        user = SuperAdminService.toggle_status(admin, new_status=data['status'])
        
        return jsonify({
            'success': True,
            'message': f'Admin status updated to {user.status.value}',
            'data': {
                'admin': admin.to_dict(include_user=True)
            }
        }), 200
        
    except ValidationError as e:
        return jsonify({
            'success': False,
            'error': 'Validation error',
            'details': e.messages
        }), 400
    except ValueError as e:
        return jsonify({
            'success': False,
            'error': 'Validation error',
            'message': str(e)
        }), 400


# --- Permissions ---

@super_admin_bp.route('/permissions', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_permissions():
    """
    List all available permissions.
    Both super admins and sub admins can view this.
    
    Returns:
        200: List of all permissions
    """
    permissions = SuperAdminService.get_all_permissions()
    
    return jsonify({
        'success': True,
        'data': {
            'permissions': permissions
        }
    }), 200
