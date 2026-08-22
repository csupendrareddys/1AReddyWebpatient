"""Evidence-based feature inventory for the apex tenant.

The apex was never plan-gated, so "which features does it use" cannot be
read off its plan (plan1 grants none of the 72 paths). Instead, probe the
tables that back each feature group and report row counts. A feature with
real rows behind it is a feature Larazen actually uses and must keep after
it moves onto a real plan.

Read-only. Each probe is independent so a schema surprise on one metric
does not hide the others.
"""
import json

from app import create_app
from app.extensions import db
from app.models import Tenant


def main():
    app = create_app()
    with app.app_context():
        t = Tenant.query.filter_by(is_platform=True).first()
        tid = t.id
        ev = {}

        def probe(feature_paths, label, sql, params=None):
            """Count rows backing a feature group."""
            try:
                n = db.session.execute(
                    db.text(sql), {'tid': str(tid), **(params or {})}
                ).scalar()
                n = int(n or 0)
            except Exception as e:  # noqa: BLE001
                ev[label] = {'error': f'{type(e).__name__}: {str(e)[:120]}'}
                db.session.rollback()
                return
            ev[label] = {'rows': n, 'features': feature_paths}

        C = 'SELECT count(*) FROM {} WHERE tenant_id = :tid'

        probe(['patient.basic_info'], 'patients', C.format('patients'))
        probe(['patient.health_records', 'patient.vitals'],
              'health_records', C.format('health_records'))
        probe(['patient.family'], 'patient_family_roles', C.format('patient_roles'))
        probe(['doctor.profile', 'doctor.calendar', 'doctor.pricing'],
              'doctors', C.format('doctors'))
        probe(['doctor.prescriptions', 'doctor.prescriptions_pdf'],
              'prescriptions', C.format('prescriptions'))
        probe(['doctor.attendance'], 'doctor_attendance',
              C.format('doctor_attendance'))
        probe(['consultation.in_person', 'consultation.video',
               'consultation.audio', 'consultation.chat'],
              'appointments', C.format('appointments'))
        probe(['communication.channel', 'communication.scheduled_calls'],
              'service_channels', C.format('service_channels'))
        probe(['clinic.multi_location', 'organization.multi_location'],
              'branch_clinics',
              'SELECT count(*) FROM clinics WHERE tenant_id = :tid '
              'AND parent_clinic_id IS NOT NULL')
        probe(['clinic.marketplace', 'organization.marketplace',
               'marketplace.doctor.listing', 'marketplace.clinic.listing',
               'marketplace.hospital.listing'],
              'membership_plans', C.format('membership_plans'))
        probe(['tenant.can_create_doctor_plans',
               'tenant.can_create_clinic_plans',
               'tenant.can_create_hospital_plans'],
              'tenant_provider_plans', C.format('tenant_provider_plans'))
        probe(['admin.landing_builder'], 'landing_configs',
              C.format('landing_configs'))
        probe(['admin.page_configuration'], 'page_configs',
              C.format('page_configs'))
        probe(['admin.field_approval'], 'field_approvals',
              C.format('field_approvals'))
        probe(['admin.billing_config'], 'billing_configs',
              C.format('billing_configs'))
        probe(['payments.razorpay'], 'payments', C.format('payments'))
        probe(['service.offer'], 'products', C.format('products'))
        probe(['group_offering.offer'], 'group_offerings',
              C.format('group_offerings'))
        probe(['admin.manage_users'], 'custom_roles', C.format('roles'))
        probe(['clinic.doctor_payouts', 'organization.doctor_payouts'],
              'doctor_payouts', C.format('doctor_payouts'))

        used, unused, errored = [], [], []
        for label, r in ev.items():
            if 'error' in r:
                errored.append(label)
            elif r['rows'] > 0:
                used.extend(r['features'])
            else:
                unused.append(label)

        print(json.dumps({
            'evidence': ev,
            'summary': {
                'features_with_evidence': sorted(set(used)),
                'groups_with_no_rows': sorted(unused),
                'probes_errored': sorted(errored),
            },
        }, indent=2))


if __name__ == '__main__':
    main()
