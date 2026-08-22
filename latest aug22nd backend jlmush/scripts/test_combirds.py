"""Minimal Combirds (Edumarc) SMS smoke test — raw HTTP POST per docs.

Standalone — does NOT touch the Flask app or DB. Run from anywhere
``requests`` is installed:

    python scripts/test_combirds.py

Fill in the four CONFIG values below. ``MESSAGE`` MUST match the body
that was DLT-approved for ``TEMPLATE_ID`` exactly (variable substitutions
already filled in) — VI rejects mid-send if the wording drifts even by
a punctuation mark.

Once this prints a ``transactionId`` (or similar success payload) and
the SMS arrives on your phone, you know:
* COMBIRDS_API_KEY is valid
* sender header LARAZN is registered against your account
* the DLT template ID matches the body
* ``sms_service.py`` will work in production with the same env vars.
"""
import requests


# ── CONFIG ─────────────────────────────────────────────────────────
API_KEY      = "REPLACE_WITH_COMBIRDS_API_KEY"
SMS_URL      = "https://smsapi.edumarcsms.com/api/v1/sendsms"
SENDER_ID    = "LARAZN"

# Use any one of your DLT-approved login-module template IDs. Easiest
# to test with login_otp_v5 since it's single-variable (just the OTP).
# Body MUST match the registered template character-for-character with
# all {#numeric#} / {#alphanumeric#} slots already filled in.
TEMPLATE_ID  = "1107177736438857609"   # larazn_login_otp_v5
MESSAGE      = (
    "Your OTP for login is 123456. It is valid for 10 minutes. "
    "Do not share this OTP with anyone. - LARAZEN"
)

# Plain 10-digit Indian mobile number, no +91, no spaces.
TO_NUMBER    = "9999999999"   # ← replace with YOUR mobile number
# ───────────────────────────────────────────────────────────────────


payload = {
    "number": [TO_NUMBER],
    "message": MESSAGE,
    "senderId": SENDER_ID,
    "templateId": TEMPLATE_ID,
}
headers = {
    "Content-Type": "application/json",
    "apikey": API_KEY,
}

print(f"POST {SMS_URL}")
print(f"  senderId={SENDER_ID}  templateId={TEMPLATE_ID}  to={TO_NUMBER}")
print(f"  message={MESSAGE!r}")
print()

resp = requests.post(SMS_URL, json=payload, headers=headers, timeout=15)
print(f"HTTP {resp.status_code}")
try:
    print("Response:", resp.json())
except ValueError:
    print("Response (raw):", resp.text)
