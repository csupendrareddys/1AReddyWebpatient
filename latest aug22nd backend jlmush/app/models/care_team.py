"""Shared care-team serialization.

Both landing stacks pin doctors to a feature page: the tenant stack via
``feature_doctors`` and the apex/marketing stack via
``platform_feature_doctors``. The tables differ (the platform stack carries no
``tenant_id`` and has no RLS, mirroring the rest of that stack) but the columns
that matter — one boolean per revealable field plus a hand-written blurb — and
the way they resolve against live doctor data are identical.

That resolution lives here so the two can't drift. Columns and relationships
stay declared on each model, matching how the two stacks mirror each other
elsewhere.

Nothing about a doctor is ever copied into these tables: name, photo,
experience, languages, city and work qualification are read live at
serialization time, so editing a doctor's profile updates every feature page
they appear on.
"""


class CareTeamMemberMixin:
    """``_resolved_doctor`` + ``to_dict`` for a care-team link row.

    Expects the host model to provide the ``photo`` / ``experience`` /
    ``languages`` / ``location`` / ``work_qualification`` booleans, a
    ``description``, a ``display_order``, a ``doctor`` relationship and an
    ``about`` relationship (to the doctor's :class:`ProfileAbout`).
    """

    #: Booleans that gate a field on the public card.
    TOGGLES = ('photo', 'experience', 'languages', 'location', 'work_qualification')

    def _resolved_doctor(self):
        """Live doctor fields, filtered by this row's toggles.

        Every key is always present so the frontend can render without
        existence checks; a toggled-off (or simply missing) field is ``None``.
        """
        doc = self.doctor
        user = getattr(doc, 'user', None) if doc else None

        city = None
        if self.location and doc:
            # Doctors have no scalar city column — the normalized value lives
            # in the communication_address JSON blob.
            addr = doc.communication_address or {}
            if isinstance(addr, dict):
                city = addr.get('current_city') or addr.get('city')

        work = None
        if self.work_qualification:
            cat = getattr(self.about, 'work_qualification', None)
            work = cat.name if cat else None

        full_name = None
        if user:
            full_name = ' '.join(
                p for p in (user.first_name, user.last_name) if p
            ).strip() or None

        return {
            'id': str(self.doctor_id),
            # Name is never toggleable — it's the anchor of the card.
            'name': full_name,
            'photo': (user.profile_image if user else None) if self.photo else None,
            'experience_years': (doc.experience_years if doc else None) if self.experience else None,
            'languages': (doc.languages_known or [] if doc else []) if self.languages else None,
            'location': city,
            'work_qualification': work,
        }

    def _resolved_team(self):
        """Live team fields for a team-unit care-team row (group offerings).

        Name + member names are read live from the service group so a roster
        edit shows up on every feature page the team appears on.
        """
        team = getattr(self, 'team', None)
        if not team:
            return None
        lead = getattr(team, 'lead', None)
        name = (lead.full_name + "'s team") if lead and lead.full_name else 'Team'
        members = [m.doctor_name for m in getattr(team, 'members', []) if m.doctor_name]
        return {
            'id': str(self.team_id),
            'name': name,
            'members': members,
        }

    def to_dict(self):
        team_id = getattr(self, 'team_id', None)
        return {
            'id': str(self.id),
            'feature_id': str(self.feature_id),
            'doctor_id': str(self.doctor_id) if self.doctor_id else None,
            'team_id': str(team_id) if team_id else None,
            'photo': self.photo,
            'experience': self.experience,
            'languages': self.languages,
            'location': self.location,
            'work_qualification': self.work_qualification,
            'description': self.description,
            'display_order': self.display_order,
            # Resolved live values. A row is either a single doctor OR a whole
            # team (group offering) — never both.
            'doctor': None if team_id else self._resolved_doctor(),
            'team': self._resolved_team() if team_id else None,
        }
