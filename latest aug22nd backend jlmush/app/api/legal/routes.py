from flask import Blueprint, jsonify
from app.api.page_config.service import PageConfigService, AssetService

legal_bp = Blueprint('legal', __name__)

@legal_bp.route('/terms', methods=['GET'])
def get_terms():
    """Get Terms and Conditions content or URL."""
    # Try to find terms in patient_login config (primary)
    config = PageConfigService.get_live_config('patient_login')
    
    doc_url = None
    content = "Terms and Conditions"
    if config and config.terms_asset_id:
        asset = AssetService.get_asset_by_id(config.terms_asset_id)
        if asset:
            doc_url = asset.get_presigned_url()
            # We don't need to append text if we have the URL, the UI will handle it.
            # But we keep some text as fallback or intro.
            content = "Terms and Conditions Document" 
    
    return jsonify({'success': True, 'content': content, 'doc_url': doc_url})

@legal_bp.route('/privacy', methods=['GET'])
def get_privacy():
    """Get Privacy Policy content or URL."""
    # Try to find privacy in patient_login config
    config = PageConfigService.get_live_config('patient_login')
    
    content = "Privacy Policy\n\n1. Information Collection\nWe collect information from you when you register on our site."
    
    doc_url = None
    if config and config.privacy_asset_id:
        asset = AssetService.get_asset_by_id(config.privacy_asset_id)
        if asset:
            doc_url = asset.get_presigned_url()
            content = "Privacy Policy Document"

    return jsonify({'success': True, 'content': content, 'doc_url': doc_url})
