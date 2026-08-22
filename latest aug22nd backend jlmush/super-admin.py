#!/usr/bin/env python
"""
Script to create a super admin user.
Usage: docker-compose exec backend python super-admin.py
"""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app
from app.extensions import db
from app.api.admin.super_admin.service import SuperAdminService

def create_super_admin():
    """Interactive super admin creation."""
    app = create_app()
    with app.app_context():
        print("\n🔐 Super Admin Creation Wizard\n")
        print("=" * 40)
        
        # Get user input
        first_name = input("First Name: ").strip()
        last_name = input("Last Name: ").strip()
        phone = input("Phone Number (e.g., +919876543210): ").strip()
        email = input("Email (optional, press Enter to skip): ").strip() or None
        password = input("Password: ").strip()
        confirm_password = input("Confirm Password: ").strip()
        
        if password != confirm_password:
            print("❌ Passwords do not match!")
            sys.exit(1)
        
        if len(password) < 6:
            print("❌ Password must be at least 6 characters!")
            sys.exit(1)
        
        try:
            data = {
                'first_name': first_name,
                'last_name': last_name,
                'phone_number': phone,
                'email': email,
                'password': password,
                'role': 'super_admin',
            }
            
            user, admin = SuperAdminService.create_admin(data)
            
            print("\n" + "=" * 40)
            print("✅ Super Admin created successfully!")
            print(f"   Phone: {phone}")
            print(f"   Name: {first_name} {last_name}")
            if email:
                print(f"   Email: {email}")
            print("=" * 40 + "\n")
            
        except ValueError as e:
            print(f"\n❌ Error: {e}")
            sys.exit(1)
        except Exception as e:
            print(f"\n❌ Unexpected error: {e}")
            sys.exit(1)

if __name__ == '__main__':
    create_super_admin()
