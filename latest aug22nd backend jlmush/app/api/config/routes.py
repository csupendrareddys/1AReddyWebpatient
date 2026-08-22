"""
Config Routes
Public and admin API endpoints for frontend configurations
"""
from flask import request, jsonify
from flask_jwt_extended import jwt_required, current_user

from app.api.config import config_bp
from app.api.config.service import LoginPageConfigService
from app.common.decorators import permission_required
from app.common.responses import success_response, error_response


# --- Public Endpoints (No Auth Required) ---

@config_bp.route('/login-page', methods=['GET'])
def get_login_page_config():
    """
    Get active login page configuration for display.
    This is a public endpoint - no authentication required.
    
    Returns:
        JSON with login page configuration including:
        - Branding (logo, title)
        - Text labels for all UI elements
        - Visibility toggles (is_present flags)
        - Form fields configuration
        - User types
        - Extra buttons
    """
    try:
        config = LoginPageConfigService.get_active_config()
        
        if not config:
            return error_response('No active login page configuration found', status_code=404)
        
        return success_response(
            data=config.to_dict(include_children=True),
            message='Login page configuration retrieved successfully'
        )
    except Exception as e:
        return error_response(f'Error retrieving login page configuration: {str(e)}', status_code=500)


# --- Admin Endpoints (Auth + Permission Required) ---

@config_bp.route('/admin/login-page', methods=['GET'])
@jwt_required()
@permission_required('manage_login_config')
def admin_get_login_page_config():
    """
    Get login page configuration for admin editing.
    Includes all fields regardless of is_present status.
    """
    try:
        config = LoginPageConfigService.get_active_config()
        
        if not config:
            return error_response('No active login page configuration found', status_code=404)
        
        # Include all children (even hidden ones) for admin view
        data = config.to_dict(include_children=False)
        data['fields'] = [f.to_dict() for f in config.fields.order_by('display_order')]
        data['user_types'] = [ut.to_dict() for ut in config.user_types.order_by('display_order')]
        data['extra_buttons'] = [eb.to_dict() for eb in config.extra_buttons.order_by('display_order')]
        
        return success_response(
            data=data,
            message='Login page configuration retrieved for admin'
        )
    except Exception as e:
        return error_response(f'Error retrieving configuration: {str(e)}', status_code=500)


@config_bp.route('/admin/login-page', methods=['PUT'])
@jwt_required()
@permission_required('manage_login_config')
def admin_update_login_page_config():
    """
    Update login page configuration.
    
    Request Body:
        JSON with any updateable config fields:
        - logo_url, logo_alt_text, logo_is_present
        - page_title, page_subtitle
        - All text labels and is_present flags
    """
    try:
        data = request.get_json()
        if not data:
            return error_response('No data provided', status_code=400)
        
        config = LoginPageConfigService.get_active_config()
        if not config:
            return error_response('No active configuration found', status_code=404)
        
        updated_config = LoginPageConfigService.update_config(str(config.id), data)
        
        return success_response(
            data=updated_config.to_dict(include_children=True),
            message='Login page configuration updated successfully'
        )
    except Exception as e:
        return error_response(f'Error updating configuration: {str(e)}', status_code=500)


@config_bp.route('/admin/login-page/field', methods=['POST'])
@jwt_required()
@permission_required('manage_login_config')
def admin_add_field():
    """
    Add a new field to the login page.
    
    Request Body:
        {
            "field_key": "custom_field",
            "field_type": "text",
            "label": "Custom Field",
            "placeholder": "Enter value",
            "display_order": 3
        }
    """
    try:
        data = request.get_json()
        if not data or 'field_key' not in data or 'label' not in data:
            return error_response('field_key and label are required', status_code=400)
        
        config = LoginPageConfigService.get_active_config()
        if not config:
            return error_response('No active configuration found', status_code=404)
        
        field = LoginPageConfigService.add_field(str(config.id), data)
        
        return success_response(
            data=field.to_dict(),
            message='Field added successfully'
        ), 201
    except Exception as e:
        return error_response(f'Error adding field: {str(e)}', status_code=500)


@config_bp.route('/admin/login-page/field/<field_id>', methods=['PUT'])
@jwt_required()
@permission_required('manage_login_config')
def admin_update_field(field_id):
    """Update a specific field configuration."""
    try:
        data = request.get_json()
        if not data:
            return error_response('No data provided', status_code=400)
        
        field = LoginPageConfigService.update_field(field_id, data)
        if not field:
            return error_response('Field not found', status_code=404)
        
        return success_response(
            data=field.to_dict(),
            message='Field updated successfully'
        )
    except Exception as e:
        return error_response(f'Error updating field: {str(e)}', status_code=500)


@config_bp.route('/admin/login-page/field/<field_id>', methods=['DELETE'])
@jwt_required()
@permission_required('manage_login_config')
def admin_delete_field(field_id):
    """Delete a field from the login page."""
    try:
        success = LoginPageConfigService.delete_field(field_id)
        if not success:
            return error_response('Field not found', status_code=404)
        
        return success_response(message='Field deleted successfully')
    except Exception as e:
        return error_response(f'Error deleting field: {str(e)}', status_code=500)


@config_bp.route('/admin/login-page/user-type/<user_type_id>', methods=['PUT'])
@jwt_required()
@permission_required('manage_login_config')
def admin_update_user_type(user_type_id):
    """Update a user type configuration."""
    try:
        data = request.get_json()
        if not data:
            return error_response('No data provided', status_code=400)
        
        user_type = LoginPageConfigService.update_user_type(user_type_id, data)
        if not user_type:
            return error_response('User type not found', status_code=404)
        
        return success_response(
            data=user_type.to_dict(),
            message='User type updated successfully'
        )
    except Exception as e:
        return error_response(f'Error updating user type: {str(e)}', status_code=500)


@config_bp.route('/admin/login-page/extra-button', methods=['POST'])
@jwt_required()
@permission_required('manage_login_config')
def admin_add_extra_button():
    """
    Add a new extra button to the login page.
    
    Request Body:
        {
            "button_text": "Login with Google",
            "button_type": "outlined",
            "button_color": "primary",
            "action_type": "link",
            "action_value": "/auth/google",
            "icon": "Google",
            "display_order": 1
        }
    """
    try:
        data = request.get_json()
        if not data or 'button_text' not in data or 'action_type' not in data:
            return error_response('button_text and action_type are required', status_code=400)
        
        config = LoginPageConfigService.get_active_config()
        if not config:
            return error_response('No active configuration found', status_code=404)
        
        button = LoginPageConfigService.add_extra_button(str(config.id), data)
        
        return success_response(
            data=button.to_dict(),
            message='Extra button added successfully'
        ), 201
    except Exception as e:
        return error_response(f'Error adding extra button: {str(e)}', status_code=500)


@config_bp.route('/admin/login-page/extra-button/<button_id>', methods=['PUT'])
@jwt_required()
@permission_required('manage_login_config')
def admin_update_extra_button(button_id):
    """Update an extra button configuration."""
    try:
        data = request.get_json()
        if not data:
            return error_response('No data provided', status_code=400)
        
        button = LoginPageConfigService.update_extra_button(button_id, data)
        if not button:
            return error_response('Extra button not found', status_code=404)
        
        return success_response(
            data=button.to_dict(),
            message='Extra button updated successfully'
        )
    except Exception as e:
        return error_response(f'Error updating extra button: {str(e)}', status_code=500)


@config_bp.route('/admin/login-page/extra-button/<button_id>', methods=['DELETE'])
@jwt_required()
@permission_required('manage_login_config')
def admin_delete_extra_button(button_id):
    """Delete an extra button from the login page."""
    try:
        success = LoginPageConfigService.delete_extra_button(button_id)
        if not success:
            return error_response('Extra button not found', status_code=404)
        
        return success_response(message='Extra button deleted successfully')
    except Exception as e:
        return error_response(f'Error deleting extra button: {str(e)}', status_code=500)
