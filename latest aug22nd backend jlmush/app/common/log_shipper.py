"""Ship access/audit log files to S3 and cap local disk.

Counterpart of ``client_context.py``'s per-process JSONL files. Runs as an
hourly APScheduler job on the leader worker. A file is shipped once it has
been IDLE for ``IDLE_MINUTES`` — live files are still being appended to by
their worker process, so mtime-idleness is the safe "this file is closed
or its worker died" signal without any cross-process coordination.

Destination: ``s3://$LOG_S3_BUCKET/$LOG_S3_PREFIX/<YYYY-MM-DD>/<host>-<file>``.
Without ``LOG_S3_BUCKET`` the job only prunes local files older than
``LOCAL_RETAIN_DAYS`` (so a dev box never fills its disk) and logs that
shipping is off. Upload errors leave the file in place for the next run.
"""
import logging
import os
import socket
import time

logger = logging.getLogger(__name__)

IDLE_MINUTES = 10
LOCAL_RETAIN_DAYS = 7


def _log_dir():
    return os.environ.get('LOG_DIR', '/tmp/jlmush-logs')


def run_log_shipping(app):
    with app.app_context():
        from app.extensions import get_redis_client
        redis = get_redis_client()
        if redis and not redis.set('job:log_shipping:lock', '1', nx=True, ex=300):
            return
        try:
            _ship_once()
        finally:
            if redis:
                redis.delete('job:log_shipping:lock')


def _ship_once():
    log_dir = _log_dir()
    if not os.path.isdir(log_dir):
        return
    bucket = os.environ.get('LOG_S3_BUCKET')
    prefix = os.environ.get('LOG_S3_PREFIX', 'backend-logs').strip('/')
    host = socket.gethostname()
    now = time.time()

    candidates = sorted(
        f for f in os.listdir(log_dir)
        if f.startswith('access-') and f.endswith('.jsonl')
    )
    if not candidates:
        return

    client = None
    if bucket:
        try:
            import boto3
            client = boto3.client('s3')
        except Exception:  # noqa: BLE001 — missing dep/creds: prune-only mode
            logger.exception('[LOGSHIP] S3 client unavailable — prune-only')
    else:
        logger.info('[LOGSHIP] LOG_S3_BUCKET not set — pruning only (%d files)',
                    len(candidates))

    shipped = pruned = 0
    for name in candidates:
        path = os.path.join(log_dir, name)
        try:
            stat = os.stat(path)
        except OSError:
            continue
        idle = (now - stat.st_mtime) >= IDLE_MINUTES * 60
        if client and idle:
            if stat.st_size == 0:
                os.unlink(path)
                continue
            day = time.strftime('%Y-%m-%d', time.gmtime(stat.st_mtime))
            key = f'{prefix}/{day}/{host}-{name}'
            try:
                client.upload_file(path, bucket, key)
                os.unlink(path)
                shipped += 1
            except Exception:  # noqa: BLE001 — retry next run
                logger.exception('[LOGSHIP] upload failed %s', name)
        elif not client and (now - stat.st_mtime) >= LOCAL_RETAIN_DAYS * 86400:
            try:
                os.unlink(path)
                pruned += 1
            except OSError:
                pass
    if shipped or pruned:
        logger.info('[LOGSHIP] shipped=%d pruned=%d', shipped, pruned)
