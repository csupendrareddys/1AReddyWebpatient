"""Real-time communication channel (Socket.IO).

Powers the Service Communication feature (Service Chats): the doctor <-> patient
conversation attached to a PurchasedService. Postgres stays the source of truth
— messages are written over REST first, then this layer only *broadcasts* the
committed rows. Nothing here originates a message.

Modules:
  * ``events``  — @socketio.on handlers (connect/auth, join/leave, typing, read)
  * ``emit``    — server-side broadcast helpers called from REST routes/services
                  after a successful DB commit (persist-first ordering)
  * ``origins`` — connect-time Origin allow-list (mirrors the HTTP CORS policy,
                  including wildcard tenant subdomains)
  * ``rooms``   — tenant-namespaced room-name helpers shared by events + emit
"""
