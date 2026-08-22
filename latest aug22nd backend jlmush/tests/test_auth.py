"""
Tests for authentication endpoints.
"""
import pytest
import json


class TestPatientSignup:
    """Tests for patient signup endpoint."""
    
    def test_signup_without_phone(self, client, db_session):
        """Signup WITHOUT a phone is refused: the pre-signup phone-OTP flow
        made ``phone_number`` + ``phone_verification_token`` mandatory."""
        response = client.post('/api/v1/auth/signup',
            data=json.dumps({
                'email': 'newpatient@test.com',
                'password': 'TestPass123!',
                'first_name': 'New',
                'last_name': 'Patient',
                'state': 'Karnataka',
                'role': 'patient'
            }),
            content_type='application/json'
        )

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert data.get('success') is False
        assert data.get('code')  # machine code always present
    
    def test_signup_with_phone(self, client, db_session):
        """A phone alone is not enough — the OTP proof
        (``phone_verification_token``) is what admits a signup."""
        response = client.post('/api/v1/auth/signup',
            data=json.dumps({
                'email': 'patientwithphone@test.com',
                'password': 'TestPass123!',
                'first_name': 'Phone',
                'last_name': 'Patient',
                'phone_number': '9876543210',
                'state': 'Karnataka',
                'role': 'patient'
            }),
            content_type='application/json'
        )

        assert response.status_code == 422
        errors = (response.get_json() or {}).get('errors') or {}
        assert 'phone_verification_token' in errors
    
    def test_signup_invalid_password(self, client, db_session):
        """Test signup fails with weak password."""
        response = client.post('/api/v1/auth/signup',
            data=json.dumps({
                'email': 'weakpass@test.com',
                'password': 'weak',  # Too short, no uppercase, etc.
                'first_name': 'Weak',
                'state': 'Karnataka',
                'role': 'patient'
            }),
            content_type='application/json'
        )
        
        assert response.status_code == 400 or response.status_code == 422


class TestEmailOTP:
    """Tests for email OTP endpoints."""
    
    def test_send_email_otp_format(self, client, db_session):
        """Test email OTP request format validation."""
        # Email OTP endpoints are deliberately disabled (410 + frozen
        # code) while email verification is bypassed.
        response = client.post('/api/v1/auth/send-email-otp',
            data=json.dumps({'email': 'not-an-email'}),
            content_type='application/json'
        )

        assert response.status_code == 410
        assert (response.get_json() or {}).get('code') == 'EMAIL_OTP_DISABLED'
    
    def test_verify_otp_invalid(self, client, db_session):
        """Test OTP verification with invalid code."""
        response = client.post('/api/v1/auth/verify-email-otp',
            data=json.dumps({
                'email': 'test@example.com',
                'otp': '000000'  # Invalid OTP
            }),
            content_type='application/json'
        )
        
        assert response.status_code == 410
        assert (response.get_json() or {}).get('code') == 'EMAIL_OTP_DISABLED'


class TestLogin:
    """Tests for login endpoint."""
    
    def test_login_with_email(self, client, sample_patient):
        """Test login with email credential."""
        user, _ = sample_patient
        
        response = client.post('/api/v1/auth/signin',
            data=json.dumps({
                'email': user.email,
                'password': 'TestPass123!'
            }),
            content_type='application/json'
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert data.get('success') == True
        assert 'user' in data.get('data', {})
    
    def test_login_invalid_password(self, client, sample_patient):
        """Test login fails with wrong password."""
        user, _ = sample_patient
        
        response = client.post('/api/v1/auth/signin',
            data=json.dumps({
                'email': user.email,
                'password': 'WrongPassword123!'
            }),
            content_type='application/json'
        )
        
        assert response.status_code == 401
