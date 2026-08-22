from flask import Blueprint

# Create a blueprint for auth
auth_bp = Blueprint("auth", __name__)

from app.auth import route  # import routes so they get registered
