"""Per-module route registrar (Round 9, Phase 3).

Each of the five page_type blueprints (doctor_profile, admin_profile,
doctor_signup, patient_profile, patient_appointment) exposes the
same per-module REST surface:

  GET    /admin/<page_type>/modules                          → list modules + states
  GET    /admin/<page_type>/<module>/draft                   → get or create DRAFT
  PUT    /admin/<page_type>/<module>/draft/fields            → bulk-update DRAFT field rows
  DELETE /admin/<page_type>/<module>/draft/fields/<field_id> → delete a non-default field
  POST   /admin/<page_type>/<module>/preview                 → DRAFT → PREVIEW
  GET    /admin/<page_type>/<module>/preview                 → fetch PREVIEW
  POST   /admin/<page_type>/<module>/publish                 → PREVIEW → LIVE
  GET    /admin/<page_type>/<module>/history                 → version history
  POST   /admin/<page_type>/<module>/restore/<version_id>    → restore historical version

Rather than copy-paste the nine handlers × five page_types (~1000
LOC), this module exposes ``register_module_routes(...)`` — each
page_type's ``routes.py`` calls it once and the routes are attached
to its blueprint with the right URL prefix + permission decorator.

Hot path: the lookup helper (``for_module``) and the modules list
helper (``list_modules``) are passed in as callables — they vary
per page_type but the route bodies are identical.

Patient-appointment caveat: that page_type comes in two PageType
flavors (FILTER and SYMPTOMS) which share a blueprint. The patient
appointment routes.py registers TWICE, once per flavor, with
different URL prefixes so each surface ends up with its own
``/admin/patient_appointment_filter/<module>/...`` path.
"""
from __future__ import annotations

from typing import Callable

from flask import current_app, jsonify, request
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required
from app.models import UserRole


# ----------------------------------------------------------------------
# Internal response helpers — copy of the pattern each page_type's
# routes.py uses (success_response / error_response / _log_and_surface).
# Kept inline here to avoid yet another shared helper module.
# ----------------------------------------------------------------------

def _success(data, message=None, status_code=200):
    body = {'success': True, 'data': data}
    if message:
        body['message'] = message
    return jsonify(body), status_code


def _error(message, status_code=400, error_type='Bad Request'):
    return jsonify({
        'success': False,
        'error': error_type,
        'message': message,
    }), status_code


def _log_and_surface(operation):
    """Log full traceback + return a 500 carrying the exception type/message.

    Caller must be inside an ``except`` block (uses ``sys.exc_info``).
    Keeps per-module endpoints debuggable from the client without
    grepping logs — mirrors what each page_type's routes.py already
    does for legacy page-wide handlers.
    """
    import sys
    exc = sys.exc_info()[1]
    current_app.logger.exception(
        'module_routes.%s failed (path=%s, args=%s, user=%s)',
        operation,
        request.path,
        dict(request.args),
        getattr(current_user, 'id', None),
    )
    return _error(
        f'{type(exc).__name__}: {exc}',
        status_code=500,
        error_type='Internal Server Error',
    )


# ----------------------------------------------------------------------
# Registrar
# ----------------------------------------------------------------------

def register_module_routes(
    *,
    blueprint,
    url_prefix: str,
    for_module: Callable[[str], 'ModuleLifecycle'],  # noqa: F821
    list_modules: Callable[[], tuple[str, ...]],
    resolve_data_source: Callable[[str], object] | None = None,
    required_role: UserRole = UserRole.SUPER_ADMIN,
    handler_prefix: str = '',
):
    """Attach the per-module REST surface to ``blueprint``.

    Args:
        blueprint: Flask Blueprint to mount on.
        url_prefix: per-page-type URL segment. e.g. ``'admin/doctor_profile'``.
            The leading ``/`` is added automatically. Do NOT include a
            trailing slash.
        for_module: zero-arg callable that, given a module key,
            returns a ``ModuleLifecycle``. Page-type-specific.
        list_modules: zero-arg callable returning the canonical list
            of module identifiers for this page_type.
        resolve_data_source: optional ``data_source → list[option]``
            resolver. If provided, the GET-draft endpoint also
            returns the resolved options bundle the editor needs.
        required_role: role gate. Defaults to SUPER_ADMIN to match
            the existing page-wide endpoints.
        handler_prefix: optional prefix prepended to every Flask
            endpoint name. Required when registering multiple times
            against the same blueprint (e.g. patient_appointment's
            FILTER + SYMPTOMS split). Endpoint names must be unique
            within a blueprint.
    """
    prefix = url_prefix.lstrip('/').rstrip('/')

    def _module_or_404(module_key):
        if module_key not in list_modules():
            return None, _error(
                f"Unknown module '{module_key}'. Known modules: "
                f"{', '.join(list_modules())}",
                status_code=404, error_type='Not Found',
            )
        return for_module(module_key), None

    def _ep(name):
        return f'{handler_prefix}{name}' if handler_prefix else name

    @blueprint.route(f'/{prefix}/modules', methods=['GET'], endpoint=_ep('list_modules'))
    @jwt_required()
    @role_required(required_role)
    def list_modules_route():
        """List all modules + their current lifecycle state."""
        out = []
        for mod_key in list_modules():
            lifecycle = for_module(mod_key)
            out.append({
                'module': mod_key,
                'states': lifecycle.get_all(),
            })
        return _success(out)

    @blueprint.route(
        f'/{prefix}/<module_key>/draft', methods=['GET'],
        endpoint=_ep('get_module_draft'),
    )
    @jwt_required()
    @role_required(required_role)
    def get_module_draft(module_key):
        lifecycle, err = _module_or_404(module_key)
        if err:
            return err
        try:
            user_id = str(current_user.id) if current_user else None
            draft = lifecycle.get_or_create_draft(user_id)
            out = draft.to_dict()
            fields = lifecycle.get_field_configs(draft.id)
            out['field_configs'] = [f.to_dict() for f in fields]
            if resolve_data_source is not None:
                data_sources = {}
                for fc in fields:
                    ds = fc.data_source
                    if ds and ds not in data_sources:
                        data_sources[ds] = resolve_data_source(ds)
                out['data_sources'] = data_sources
            return _success(out)
        except ValueError as e:
            return _error(str(e))
        except Exception:
            return _log_and_surface(f'get_module_draft:{module_key}')

    @blueprint.route(
        f'/{prefix}/<module_key>/draft/fields', methods=['PUT'],
        endpoint=_ep('update_module_draft_fields'),
    )
    @jwt_required()
    @role_required(required_role)
    def update_module_draft_fields(module_key):
        lifecycle, err = _module_or_404(module_key)
        if err:
            return err
        data = request.get_json()
        if not data or 'fields' not in data:
            return _error("Request body must contain 'fields' array")
        try:
            user_id = str(current_user.id) if current_user else None
            updated = lifecycle.update_fields(data['fields'], user_id)
            return _success(updated, message=f'Module {module_key} fields updated')
        except ValueError as e:
            return _error(str(e))
        except Exception:
            return _log_and_surface(f'update_module_draft_fields:{module_key}')

    @blueprint.route(
        f'/{prefix}/<module_key>/draft/fields/<field_id>', methods=['DELETE'],
        endpoint=_ep('delete_module_field'),
    )
    @jwt_required()
    @role_required(required_role)
    def delete_module_field(module_key, field_id):
        lifecycle, err = _module_or_404(module_key)
        if err:
            return err
        try:
            user_id = str(current_user.id) if current_user else None
            lifecycle.delete_field(field_id, user_id)
            return _success({}, message='Field deleted')
        except ValueError as e:
            return _error(str(e))
        except Exception:
            return _log_and_surface(f'delete_module_field:{module_key}')

    @blueprint.route(
        f'/{prefix}/<module_key>/preview', methods=['POST'],
        endpoint=_ep('promote_module_to_preview'),
    )
    @jwt_required()
    @role_required(required_role)
    def promote_module_to_preview(module_key):
        lifecycle, err = _module_or_404(module_key)
        if err:
            return err
        try:
            user_id = str(current_user.id) if current_user else None
            preview = lifecycle.promote_to_preview(user_id)
            return _success(preview.to_dict(), message='Module promoted to preview')
        except ValueError as e:
            return _error(str(e))
        except Exception:
            return _log_and_surface(f'promote_module_to_preview:{module_key}')

    @blueprint.route(
        f'/{prefix}/<module_key>/preview', methods=['GET'],
        endpoint=_ep('get_module_preview'),
    )
    @jwt_required()
    @role_required(required_role)
    def get_module_preview(module_key):
        lifecycle, err = _module_or_404(module_key)
        if err:
            return err
        preview = lifecycle.get_preview()
        if not preview:
            return _error(f'No preview for module {module_key}', 404, 'Not Found')
        out = preview.to_dict()
        fields = lifecycle.get_field_configs(preview.id)
        out['field_configs'] = [f.to_dict() for f in fields]
        return _success(out)

    @blueprint.route(
        f'/{prefix}/<module_key>/publish', methods=['POST'],
        endpoint=_ep('publish_module'),
    )
    @jwt_required()
    @role_required(required_role)
    def publish_module(module_key):
        lifecycle, err = _module_or_404(module_key)
        if err:
            return err
        try:
            body = request.get_json(silent=True) or {}
            note = (body.get('note') or '').strip() or None
            user_id = str(current_user.id) if current_user else None
            live = lifecycle.publish(user_id, note=note)
            return _success(live.to_dict(), message='Module published')
        except ValueError as e:
            return _error(str(e))
        except Exception:
            return _log_and_surface(f'publish_module:{module_key}')

    @blueprint.route(
        f'/{prefix}/<module_key>/history', methods=['GET'],
        endpoint=_ep('get_module_history'),
    )
    @jwt_required()
    @role_required(required_role)
    def get_module_history(module_key):
        lifecycle, err = _module_or_404(module_key)
        if err:
            return err
        limit = request.args.get('limit', 10, type=int)
        return _success(lifecycle.get_history(limit))

    @blueprint.route(
        f'/{prefix}/<module_key>/restore/<version_id>', methods=['POST'],
        endpoint=_ep('restore_module_version'),
    )
    @jwt_required()
    @role_required(required_role)
    def restore_module_version(module_key, version_id):
        lifecycle, err = _module_or_404(module_key)
        if err:
            return err
        try:
            user_id = str(current_user.id) if current_user else None
            draft = lifecycle.restore_version(version_id, user_id)
            out = draft.to_dict()
            fields = lifecycle.get_field_configs(draft.id)
            out['field_configs'] = [f.to_dict() for f in fields]
            return _success(out, message='Module version restored to draft')
        except ValueError as e:
            return _error(str(e))
        except Exception:
            return _log_and_surface(f'restore_module_version:{module_key}')
