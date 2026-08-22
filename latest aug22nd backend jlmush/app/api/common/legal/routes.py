"""
Legal content routes
Serves Terms & Conditions and Privacy Policy from markdown files
"""
import os
from flask import jsonify, current_app
from app.api.common.legal import legal_bp


def get_legal_file_path(filename):
    """Get the absolute path to a legal document file."""
    # Go up from app/api/common/legal to project root, then into legal/
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
    return os.path.join(base_dir, 'legal', filename)


@legal_bp.route('/terms', methods=['GET'])
def get_terms_and_conditions():
    """
    Get Terms and Conditions content.
    
    Returns:
        JSON with title and markdown content
    """
    try:
        file_path = get_legal_file_path('terms_and_conditions.md')
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return jsonify({
            'success': True,
            'title': 'Terms and Conditions',
            'content': content
        }), 200
    except FileNotFoundError:
        return jsonify({
            'success': False,
            'error': 'Terms and Conditions file not found'
        }), 404
    except Exception as e:
        current_app.logger.error(f"Error reading terms and conditions: {e}")
        return jsonify({
            'success': False,
            'error': 'Failed to load Terms and Conditions'
        }), 500


@legal_bp.route('/privacy', methods=['GET'])
def get_privacy_policy():
    """
    Get Privacy Policy content.
    
    Returns:
        JSON with title and markdown content
    """
    try:
        file_path = get_legal_file_path('privacy_policy.md')
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return jsonify({
            'success': True,
            'title': 'Privacy Policy',
            'content': content
        }), 200
    except FileNotFoundError:
        return jsonify({
            'success': False,
            'error': 'Privacy Policy file not found'
        }), 404
    except Exception as e:
        current_app.logger.error(f"Error reading privacy policy: {e}")
        return jsonify({
            'success': False,
            'error': 'Failed to load Privacy Policy'
        }), 500
