"""
Video Meeting Module - Twilio Video Integration
Provides endpoints for creating video rooms and generating access tokens
"""
from flask import Blueprint

video_bp = Blueprint('video', __name__)

from app.api.common.video import routes  # noqa: E402, F401
