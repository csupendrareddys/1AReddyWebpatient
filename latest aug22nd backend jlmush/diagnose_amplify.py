"""
diagnose_amplify.py — exhaustive AWS Amplify auto-association diagnostic.

Run this from the backend host (same env that runs the Flask app) when
``CreateDomainAssociation`` is failing with errors like:

    BadRequestException: domain prefix in the request is not valid

It will check, in order:

    1. Required env vars are present and well-formed.
    2. boto3 can authenticate (calls ``amplify list-apps``).
    3. ``AMPLIFY_APP_ID`` matches a real app in the configured region.
    4. ``AMPLIFY_BRANCH`` matches a real branch on that app.
    5. The exact ``CreateDomainAssociation`` payload we *would* send,
       printed before any call so you can copy-paste into AWS support.
    6. (Optional) Actually attempts the association for ``--domain X``.

Usage::

    cd Backend
    python diagnose_amplify.py                  # diagnostic only, no API write
    python diagnose_amplify.py --domain example.com   # also try the call

Reads exactly the same env vars the live service does — ``.env`` is
auto-loaded if you have python-dotenv installed and a .env file in cwd.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap


SUCCESS = '✓'
FAILURE = '✗'
WARNING = '⚠'
INFO = '·'


def _try_load_dotenv():
    try:
        from dotenv import load_dotenv  # type: ignore
        for path in ('.env', '.env.production', '../.env', 'Backend/.env'):
            if os.path.exists(path):
                load_dotenv(path, override=False)
                print(f'  {INFO} loaded env from {path}')
                return
    except ImportError:
        pass


def _clean(raw):
    """Same trimming the live service does — strips inline ``# comment``
    tails and surrounding whitespace."""
    if not raw:
        return ''
    s = raw.strip()
    if s.startswith(('"', "'")) and s.endswith(s[0]):
        return s[1:-1]
    if '#' in s:
        s = s.split('#', 1)[0].rstrip()
    return s


def step(name):
    print(f'\n=== {name} ===')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--domain',
        help='If supplied, ALSO attempts CreateDomainAssociation for this domain '
             '(writes to AWS). Without this flag, only diagnostics are printed.',
    )
    args = parser.parse_args()

    step('1. Loading env')
    _try_load_dotenv()

    app_id = _clean(os.environ.get('AMPLIFY_APP_ID', ''))
    branch = _clean(os.environ.get('AMPLIFY_BRANCH', '')) or 'main'
    region = (
        _clean(os.environ.get('AMPLIFY_REGION', ''))
        or _clean(os.environ.get('AWS_S3_REGION', ''))
        or 'ap-south-1'
    )
    raw_prefixes = _clean(os.environ.get('AMPLIFY_SUBDOMAIN_PREFIXES', 'www'))
    prefixes_raw = [_clean(p) for p in raw_prefixes.split(',')]
    non_empty_prefixes = [p for p in prefixes_raw if p]
    if not non_empty_prefixes:
        non_empty_prefixes = ['www']

    access_key = (
        _clean(os.environ.get('AMPLIFY_AWS_ACCESS_KEY_ID', ''))
        or _clean(os.environ.get('AWS_ACCESS_KEY_ID', ''))
    )
    secret_key = (
        _clean(os.environ.get('AMPLIFY_AWS_SECRET_ACCESS_KEY', ''))
        or _clean(os.environ.get('AWS_SECRET_ACCESS_KEY', ''))
    )

    print(f'  AMPLIFY_APP_ID            = {app_id!r}')
    print(f'  AMPLIFY_BRANCH            = {branch!r}')
    print(f'  AMPLIFY_REGION            = {region!r}')
    print(f'  AMPLIFY_SUBDOMAIN_PREFIXES (raw)        = {raw_prefixes!r}')
    print(f'  AMPLIFY_SUBDOMAIN_PREFIXES (after split) = {prefixes_raw!r}')
    print(f'  AMPLIFY_SUBDOMAIN_PREFIXES (non-empty)   = {non_empty_prefixes!r}')
    print(f'  AWS access key (first 4) = {access_key[:4] if access_key else "(none)"}')
    print(f'  AWS secret key set?      = {"yes" if secret_key else "NO"}')

    if not app_id:
        print(f'\n{FAILURE} AMPLIFY_APP_ID is empty. Set it in your env. '
              'It looks like ``d2tbt5cvzg9nr0`` — the part of '
              '``main.<id>.amplifyapp.com``.')
        sys.exit(2)
    if not access_key or not secret_key:
        print(f'\n{WARNING} AWS credentials missing. boto3 will fall back to '
              'the default chain (instance profile / shared creds). If you '
              'see a NoCredentials error below, set AMPLIFY_AWS_ACCESS_KEY_ID + '
              'AMPLIFY_AWS_SECRET_ACCESS_KEY (or ensure your IAM role has '
              'amplify:* perms).')

    step('2. boto3 authentication (amplify list-apps)')
    try:
        import boto3  # noqa: WPS433
        from botocore.exceptions import ClientError, BotoCoreError
    except ImportError:
        print(f'{FAILURE} boto3 not installed. pip install -r requirements.txt')
        sys.exit(2)

    client = boto3.client(
        'amplify', region_name=region,
        aws_access_key_id=access_key or None,
        aws_secret_access_key=secret_key or None,
    )

    try:
        resp = client.list_apps(maxResults=50)
        apps = resp.get('apps', [])
        print(f'  {SUCCESS} authentication ok — {len(apps)} app(s) visible in '
              f'region {region}')
        for a in apps:
            marker = SUCCESS if a.get('appId') == app_id else INFO
            print(f'    {marker} {a.get("appId")} — {a.get("name")} '
                  f'(default branch: {a.get("productionBranch", {}).get("branchName")})')
    except ClientError as exc:
        code = (exc.response or {}).get('Error', {}).get('Code', '')
        print(f'{FAILURE} list_apps failed: {code}: {exc}')
        if code == 'UnrecognizedClientException':
            print('   → access key is invalid. Re-create it in IAM '
                  '(rotate AMPLIFY_AWS_ACCESS_KEY_ID).')
        elif code == 'AccessDeniedException':
            print('   → IAM user lacks amplify:ListApps. Attach '
                  'AdministratorAccess-Amplify to the user.')
        sys.exit(2)
    except BotoCoreError as exc:
        print(f'{FAILURE} boto3 transport error: {exc}')
        print('   → check AMPLIFY_REGION matches a real AWS region '
              '(e.g. ap-south-1, us-east-1).')
        sys.exit(2)

    step(f'3. App {app_id!r} exists in region {region!r}')
    try:
        resp = client.get_app(appId=app_id)
        app = resp.get('app', {})
        print(f'  {SUCCESS} app found: name={app.get("name")!r}, '
              f'platform={app.get("platform")}, '
              f'createTime={app.get("createTime")}')
    except ClientError as exc:
        code = (exc.response or {}).get('Error', {}).get('Code', '')
        if code == 'NotFoundException':
            print(f'{FAILURE} App {app_id!r} does NOT exist in region {region!r}.')
            print('   → either AMPLIFY_APP_ID is wrong, or the app is in a '
                  'different region. The list above shows what IS in this region.')
        else:
            print(f'{FAILURE} get_app failed: {code}: {exc}')
        sys.exit(2)

    step(f'4. Branch {branch!r} exists on the app')
    try:
        resp = client.list_branches(appId=app_id, maxResults=50)
        branches = [b.get('branchName') for b in resp.get('branches', [])]
        if branch in branches:
            print(f'  {SUCCESS} branch {branch!r} found')
        else:
            print(f'{FAILURE} branch {branch!r} NOT found on app {app_id}.')
            print(f'   Available branches: {branches}')
            print('   → either AMPLIFY_BRANCH is wrong, or you need to '
                  'connect/create the branch in Amplify console first. '
                  'Most platforms host on "main" — confirm by clicking the '
                  'app in the Amplify console and looking at the Branches list.')
            sys.exit(2)
    except ClientError as exc:
        print(f'{FAILURE} list_branches failed: {exc}')
        sys.exit(2)

    step('5. CreateDomainAssociation payload (preview)')
    sub_settings = [
        {'prefix': p, 'branchName': branch} for p in non_empty_prefixes
    ]
    payload = {
        'appId': app_id,
        'domainName': args.domain or '<your-tenant-domain>.com',
        'subDomainSettings': sub_settings,
        'enableAutoSubDomain': False,
    }
    print(textwrap.indent(json.dumps(payload, indent=2), '  '))
    print(f'  {INFO} every prefix above must be non-empty AND match the regex '
          r'``[a-z0-9](-[a-z0-9]|[a-z0-9])*`` per AWS\'s validator.')

    if not args.domain:
        print('\nDone. Re-run with --domain <your-domain> to attempt the '
              'actual API call (it WILL write to AWS).')
        return

    step(f'6. CreateDomainAssociation for {args.domain!r}')
    try:
        resp = client.create_domain_association(**payload)
        assoc = resp.get('domainAssociation', {})
        print(f'  {SUCCESS} created — domainStatus = '
              f'{assoc.get("domainStatus")!r}')
        for sd in assoc.get('subDomains', []):
            setting = sd.get('subDomainSetting', {})
            print(f'     · prefix={setting.get("prefix")!r} '
                  f'branch={setting.get("branchName")!r} '
                  f'verified={sd.get("verified")} '
                  f'dnsRecord={sd.get("dnsRecord")}')
    except ClientError as exc:
        code = (exc.response or {}).get('Error', {}).get('Code', '')
        msg = str(exc)
        print(f'{FAILURE} {code}: {msg}')
        if code == 'BadRequestException':
            if 'prefix' in msg.lower():
                print('   → AWS thinks one of the prefixes above is invalid. '
                      'Most common cause: an empty string somehow leaked '
                      'in (check the printed sub_settings list). Allowed: '
                      'letters/digits/single-asterisk, hyphens only between '
                      'characters, no leading/trailing hyphen, length >= 1.')
            elif 'already' in msg.lower():
                print('   → domain is already associated. Run UPDATE instead, '
                      'or DeleteDomainAssociation first.')
        elif code == 'LimitExceededException':
            print('   → too many domains on this Amplify app. Default limit is '
                  '50 — request increase via AWS support.')
        sys.exit(2)


if __name__ == '__main__':
    main()
