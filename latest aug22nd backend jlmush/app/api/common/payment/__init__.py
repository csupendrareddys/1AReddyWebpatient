"""
Payment Blueprint Package
Razorpay payment integration endpoints
"""
from flask import Blueprint

payment_bp = Blueprint('payment', __name__)

from app.api.common.payment.routes import *  # noqa: F401, F403
