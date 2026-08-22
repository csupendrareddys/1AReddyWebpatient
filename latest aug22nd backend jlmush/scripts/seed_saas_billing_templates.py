"""Seed the SaaS subscription billing (dunning) email templates.

Five ``notification_templates`` rows (channel='email'), consumed by the
Phase 5 billing machinery:

  * ``saas_trial_ending``    — sweep, ≤3 / ≤1 days of trial left
  * ``saas_trial_expired``   — sweep, trial lapsed → PAST_DUE
  * ``saas_payment_due``     — sweep, paid period lapsed → PAST_DUE
  * ``saas_suspended``       — sweep, grace exhausted → SUSPENDED
  * ``saas_payment_received``— receipt after a successful period payment

Idempotent — INSERT ... WHERE NOT EXISTS per row, same pattern as
``seed_verify_email_template.py``. Safe to re-run; edits to live rows are
NOT overwritten.

Usage::

    docker exec -i -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/seed_saas_billing_templates.py
"""
import json
import uuid

from sqlalchemy import text


def _wrap(title, body_html):
    """Shared minimal chrome so the five bodies stay consistent."""
    return (
        '<!DOCTYPE html>'
        '<html><body style="font-family:Arial,sans-serif;line-height:1.6;'
        'color:#333;background:#f7f7f7;margin:0;padding:0">'
        '<div style="max-width:600px;margin:0 auto;padding:24px;background:#fff">'
        f'<h2 style="color:#1976d2;margin-top:0">{title}</h2>'
        '<p>Hi {first_name},</p>'
        f'{body_html}'
        '<p style="margin-top:30px;color:#888;font-size:12px">'
        '— The {company_name} team</p>'
        '</div></body></html>'
    )


TEMPLATES = [
    {
        'purpose': 'saas_trial_ending',
        'name': 'SaaS billing — trial ending reminder',
        'subject': 'Your {company_name} trial ends in {days_left} day(s)',
        'body': _wrap(
            'Your trial is ending',
            '<p>Your free trial of the <strong>{plan_name}</strong> plan ends '
            'on <strong>{trial_end}</strong> ({days_left} day(s) left).</p>'
            '<p>To keep your workspace running without interruption, open '
            '<strong>Dashboard → Billing</strong> and pay for your first '
            'period.</p>'),
        'vars': ['first_name', 'company_name', 'plan_name', 'days_left',
                 'trial_end'],
    },
    {
        'purpose': 'saas_trial_expired',
        'name': 'SaaS billing — trial expired',
        'subject': 'Your {company_name} trial has ended — action needed',
        'body': _wrap(
            'Your trial has ended',
            '<p>The free trial of your <strong>{plan_name}</strong> plan has '
            'ended and the subscription is now marked <strong>past '
            'due</strong>.</p>'
            '<p>You have {grace_days} day(s) before the workspace is '
            'suspended. Open <strong>Dashboard → Billing</strong> to pay and '
            'keep everything running.</p>'),
        'vars': ['first_name', 'company_name', 'plan_name', 'grace_days'],
    },
    {
        'purpose': 'saas_payment_due',
        'name': 'SaaS billing — renewal due',
        'subject': 'Your {company_name} subscription payment is due',
        'body': _wrap(
            'Subscription renewal due',
            '<p>The paid period of your <strong>{plan_name}</strong> plan '
            'ended on <strong>{period_end}</strong> and the subscription is '
            'now marked <strong>past due</strong>.</p>'
            '<p>You have {grace_days} day(s) before the workspace is '
            'suspended. Open <strong>Dashboard → Billing</strong> to renew.'
            '</p>'),
        'vars': ['first_name', 'company_name', 'plan_name', 'period_end',
                 'grace_days'],
    },
    {
        'purpose': 'saas_suspended',
        'name': 'SaaS billing — subscription suspended',
        'subject': 'Your {company_name} workspace has been suspended',
        'body': _wrap(
            'Workspace suspended',
            '<p>Your <strong>{plan_name}</strong> subscription went unpaid '
            'past its grace period, so the workspace has been '
            '<strong>suspended</strong> — features are switched off for all '
            'users.</p>'
            '<p>Nothing has been deleted. Open <strong>Dashboard → '
            'Billing</strong> and pay to restore access immediately.</p>'),
        'vars': ['first_name', 'company_name', 'plan_name'],
    },
    {
        'purpose': 'saas_payment_received',
        'name': 'SaaS billing — payment receipt',
        'subject': 'Payment received — {company_name} subscription extended',
        'body': _wrap(
            'Payment received',
            '<p>We received your payment of <strong>₹{amount_inr}</strong> '
            'for one {period} period of the <strong>{plan_name}</strong> '
            'plan.</p>'
            '<p>Your subscription now runs until '
            '<strong>{period_end}</strong>. Thank you!</p>'),
        'vars': ['first_name', 'company_name', 'plan_name', 'amount_inr',
                 'period', 'period_end'],
    },
]


def main():
    from app import create_app
    from app.extensions import db

    app = create_app()
    with app.app_context():
        for spec in TEMPLATES:
            result = db.session.execute(
                text(
                    """
                    INSERT INTO notification_templates
                        (id, purpose, name, channel, template_id, sender_id,
                         subject, body_template, variable_names,
                         is_active, notes, created_at, updated_at)
                    SELECT :id, :purpose, :name, 'email', NULL, 'LARAZEN',
                           :subject, :body, CAST(:vars AS JSONB),
                           TRUE, 'Seeded by scripts/seed_saas_billing_templates.py',
                           NOW(), NOW()
                    WHERE NOT EXISTS (
                        SELECT 1 FROM notification_templates
                         WHERE channel='email' AND purpose=:purpose
                    )
                    """
                ),
                {
                    'id': str(uuid.uuid4()),
                    'purpose': spec['purpose'],
                    'name': spec['name'],
                    'subject': spec['subject'],
                    'body': spec['body'],
                    'vars': json.dumps(spec['vars']),
                },
            )
            verb = 'INSERTED' if result.rowcount else 'ALREADY EXISTS'
            print(f"{spec['purpose']}: {verb}")
        db.session.commit()


if __name__ == '__main__':
    main()
