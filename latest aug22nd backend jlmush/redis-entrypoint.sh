#!/bin/sh
#
# Redis container entrypoint.
# Reads at runtime:
#   REDIS_PASSWORD          (required)
#   REDIS_MAXMEMORY         (default 256mb)
#   REDIS_MAXMEMORY_POLICY  (default noeviction)
#   REDIS_APPENDONLY        (default yes)
#
# Two instances run from this image with opposite settings:
#   jlmush-redis (AUTH): noeviction + AOF. Holds sessions, refresh tokens,
#     OTPs, locks. Under memory pressure WRITES FAIL LOUDLY — an eviction
#     policy here would silently destroy live sessions (an evicted refresh
#     token even reads as a replay attack and revokes the session).
#   jlmush-redis-cache (CACHE): allkeys-lru, no AOF. Rate-limit counters,
#     Socket.IO message queue, response caches — all reconstructible, so
#     LRU eviction is exactly right and cache pressure can never touch auth.
#
set -e

: "${REDIS_PASSWORD:?REDIS_PASSWORD must be set}"
: "${REDIS_MAXMEMORY:=256mb}"
: "${REDIS_MAXMEMORY_POLICY:=noeviction}"
: "${REDIS_APPENDONLY:=yes}"

exec redis-server \
  --requirepass "$REDIS_PASSWORD" \
  --maxmemory "$REDIS_MAXMEMORY" \
  --maxmemory-policy "$REDIS_MAXMEMORY_POLICY" \
  --appendonly "$REDIS_APPENDONLY" \
  --save 900 1 \
  --save 300 10
