"""
Admin Seeder Script
Creates admin users (super_admin or sub_admin) for the application.

Usage:
    # From the Backend directory:
    python create_admin.py
    
    # Create super admin (default):
    python create_admin.py --email admin@example.com --phone 9876543210 --password SecurePass123!
    
    # Create sub admin with specific permissions:
    python create_admin.py --role sub_admin --permissions view_patients view_appointments --email subadmin@test.com
    
    # Inside Docker:
    docker exec -it healthcare-backend python create_admin.py
    
    # List available permissions:
    python create_admin.py --list-permissions
"""
import argparse
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def list_permissions():
    """List all available admin permissions."""
    from app.models import AdminPermission
    
    print("\n📋 Available Admin Permissions:")
    print("-" * 40)
    for perm in AdminPermission:
        print(f"  • {perm.value:25} ({perm.name})")
    print("-" * 40)
    print("\n Usage: --permissions view_patients view_appointments")


def create_admin(
    email=None,
    phone=None,
    password=None,
    first_name="Admin",
    last_name="User",
    role="super_admin",
    permissions=None,
    tenant_slug=None,
):
    """Create an admin user (super_admin or sub_admin) inside a tenant.

    Delegates to :func:`SuperAdminService.create_admin` so all validation,
    tenant resolution, and Admin-profile bookkeeping live in one place.
    """
    from app import create_app
    from app.api.admin.super_admin.service import SuperAdminService
    from app.models import Tenant

    app = create_app()
    with app.app_context():
        # Resolve / report the target tenant up front so the operator sees
        # exactly where the admin is being created.
        if tenant_slug:
            tenant = Tenant.query.filter_by(slug=tenant_slug).first()
            if not tenant:
                print(f"[ERR] Tenant slug '{tenant_slug}' not found.")
                return False
        else:
            tenant = Tenant.query.filter_by(is_default=True).first()
            if not tenant:
                print("[ERR] No default tenant. Bootstrap the DB first "
                      "(see TENANT_ARCHITECTURE.md sec 6.1).")
                return False

        try:
            user, admin = SuperAdminService.create_admin(
                {
                    'email': email,
                    'phone_number': phone,
                    'password': password,
                    'first_name': first_name,
                    'last_name': last_name,
                    'role': role,
                    'permissions': permissions or [],
                },
                tenant_id=tenant.id,
            )
        except ValueError as e:
            print(f"[ERR] {e}")
            return False

        role_display = role.replace('_', ' ').title()
        print()
        print(f"[OK] {role_display} created in tenant '{tenant.slug}'")
        print(f"     user_id    : {user.id}")
        print(f"     admin_id   : {admin.id}")
        print(f"     phone      : {phone}")
        if email:
            print(f"     email      : {email}")
        print(f"     tenant     : {tenant.slug} ({tenant.id})")
        return True


def main():
    parser = argparse.ArgumentParser(
        description="Create Admin User (Super Admin or Sub Admin)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Create super admin (default)
  python create_admin.py --email admin@test.com --phone 9999999999 --password Admin@123

  # Create sub admin with permissions
  python create_admin.py --role sub_admin --permissions view_patients view_appointments \\
    --email subadmin@test.com --phone 8888888888 --password Admin@456

  # List available permissions
  python create_admin.py --list-permissions
        """
    )
    
    parser.add_argument("--email", help="Admin email (optional)")
    parser.add_argument("--phone", default="9866590123", help="Admin phone number")
    parser.add_argument("--password", default="Admin@123", help="Admin password")
    parser.add_argument("--first-name", default="Admin", help="First name")
    parser.add_argument("--last-name", default="User", help="Last name")
    parser.add_argument(
        "--role", 
        choices=['super_admin', 'sub_admin'], 
        default='super_admin',
        help="Admin role (default: super_admin)"
    )
    parser.add_argument(
        "--permissions", 
        nargs='*', 
        default=[],
        help="Permissions for sub_admin (space-separated)"
    )
    parser.add_argument(
        "--list-permissions",
        action="store_true",
        help="List all available permissions and exit"
    )
    parser.add_argument(
        "--tenant-slug",
        help="Target tenant slug. Defaults to the platform's default tenant. "
             "Use this to create a SUPER_ADMIN inside a specific tenant — "
             "every admin must belong to one tenant; only PLATFORM_OWNER is "
             "cross-tenant (see create_platform_owner.py).",
    )

    args = parser.parse_args()
    
    # Handle list-permissions
    if args.list_permissions:
        list_permissions()
        return
    
    role_display = args.role.replace('_', ' ').title()
    print(f"\n🔧 Creating {role_display}...")
    print(f"   Phone: {args.phone}")
    if args.email:
        print(f"   Email: {args.email}")
    if args.role == 'sub_admin' and args.permissions:
        print(f"   Permissions: {', '.join(args.permissions)}")
    
    success = create_admin(
        email=args.email,
        phone=args.phone,
        password=args.password,
        first_name=args.first_name,
        last_name=args.last_name,
        role=args.role,
        permissions=args.permissions,
        tenant_slug=args.tenant_slug,
    )

    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
