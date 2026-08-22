"""Provider self-service staff management.

Registered under ``/api/provider-staff``. The provider-facing half of the
same tables the admin surface writes: a doctor, clinic or hospital managing
the people who work for THEM, from their own dashboard (My Link → Support
Staff), without going through an admin.

**Roles come in two tiers.** The tenant admin curates a shared set per vertical
(Operations → Manage Roles & Permissions) that every practice can use as-is; a
practice that needs something different authors its own, owned by them and
invisible to everyone else. A provider may read a shared role's matrix but not
change it — one clinic narrowing "Front Desk" would otherwise re-scope every
other clinic's receptionist in the tenant. See ``ProviderRole``.

**Nobody touches anyone else's staff or roles.** Every route resolves the
provider from ``current_user`` and scopes by it, so there is no id in a request
to tamper with. Another practice's row 404s rather than 403s — a provider has
no business learning that it exists.

Staff logins are minted here too, through ``app.common.staff_credentials``, so
the practice can give its front desk an account without going via an admin.
"""
from flask import Blueprint

provider_staff_bp = Blueprint('provider_staff', __name__)

from app.api.provider_staff import routes  # noqa: E402,F401
