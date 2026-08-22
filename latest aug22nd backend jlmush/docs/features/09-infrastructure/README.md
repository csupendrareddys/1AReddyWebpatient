# Infrastructure & Deployment

> **Status**: ✅ Complete (Docker setup)  
> **Stack**: Docker, PostgreSQL, Redis, Flask/Gunicorn

---

## Overview

The infrastructure uses a containerized architecture with Docker Compose for local development and production deployment.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Docker Network                                    │
│                        (healthcare-network)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │                 │  │                 │  │                 │             │
│  │   PostgreSQL    │  │     Redis       │  │  Flask Backend  │             │
│  │   (Database)    │  │    (Cache)      │  │     (API)       │             │
│  │                 │  │                 │  │                 │             │
│  │  Port: 5432     │  │  Port: 6379     │  │  Port: 5000     │             │
│  │                 │  │                 │  │                 │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│           │                    │                    │                       │
│           └────────────────────┼────────────────────┘                       │
│                                │                                            │
└────────────────────────────────┼────────────────────────────────────────────┘
                                 │
                          Host Machine
                    ┌────────────┴────────────┐
                    │                         │
               Port 5432                 Port 5001
              (PostgreSQL)               (Backend)
```

---

## Container Services

### PostgreSQL Database

| Property | Value |
|----------|-------|
| Image | `postgres:15-alpine` |
| Container Name | `healthcare-postgres` |
| Internal Port | 5432 |
| External Port | 5432 (configurable) |
| Volume | `postgres_data:/var/lib/postgresql/data` |

**Environment Variables:**
- `POSTGRES_USER` (default: postgres)
- `POSTGRES_PASSWORD` (default: postgres123)
- `POSTGRES_DB` (default: healthcare_dev)

### Redis Cache

| Property | Value |
|----------|-------|
| Image | `redis:7-alpine` |
| Container Name | `healthcare-redis` |
| Internal Port | 6379 |
| External Port | 6379 (configurable) |
| Volume | `redis_data:/data` |
| Command | `redis-server --appendonly yes` |

### Flask Backend

| Property | Value |
|----------|-------|
| Build Context | `./Backend` |
| Container Name | `healthcare-backend` |
| Internal Port | 5000 |
| External Port | 5001 (configurable) |
| WSGI Server | Gunicorn |

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `SECRET_KEY` | Flask secret key |
| `JWT_SECRET_KEY` | JWT signing key |
| `ENCRYPTION_KEY` | Fernet encryption key |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `FLASK_ENV` | development | Environment mode |
| `FLASK_DEBUG` | 1 | Debug mode |
| `CORS_ORIGINS` | localhost:3000,localhost:5173 | Allowed origins |

### Generate Encryption Key

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

---

## Development Setup

### 1. Start All Services

```bash
cd Backend
docker-compose up -d
```

### 2. Check Service Health

```bash
docker-compose ps
docker-compose logs -f backend
```

### 3. Access Services

| Service | URL |
|---------|-----|
| Backend API | http://localhost:5001 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

---

## Database Migrations

### Create Migration

```bash
docker-compose exec backend flask db migrate -m "Description"
```

### Apply Migrations

```bash
docker-compose exec backend flask db upgrade
```

### Rollback

```bash
docker-compose exec backend flask db downgrade
```

---

## Volume Management

### Persistent Volumes

| Volume | Purpose |
|--------|---------|
| `postgres_data` | Database files |
| `redis_data` | Redis AOF persistence |
| `./uploads` | User uploaded files |
| `./migrations` | Database migrations |

### View Volumes

```bash
docker volume ls
docker volume inspect healthcare_postgres_data
```

---

## Health Checks

### PostgreSQL

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U postgres"]
  interval: 10s
  timeout: 5s
  retries: 5
```

### Redis

```yaml
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 10s
  timeout: 5s
  retries: 5
```

---

## Production Deployment

### Recommended Changes

1. **Use production config**
   ```bash
   FLASK_ENV=production
   FLASK_DEBUG=0
   ```

2. **Enable HTTPS**
   ```python
   JWT_COOKIE_SECURE = True
   JWT_COOKIE_SAMESITE = 'Strict'
   ```

3. **Use managed services**
   - AWS RDS for PostgreSQL
   - AWS ElastiCache for Redis
   - AWS ECS/EKS for containers

4. **Set strong secrets**
   ```bash
   SECRET_KEY=<random-256-bit-key>
   JWT_SECRET_KEY=<random-256-bit-key>
   ENCRYPTION_KEY=<fernet-key>
   ```

---

## AWS Integration

### S3 for File Storage

```python
AWS_S3_BUCKET = 'jlmush-assets'
AWS_S3_REGION = 'ap-south-1'
```

### Required IAM Permissions

- s3:PutObject
- s3:GetObject
- s3:DeleteObject
- s3:ListBucket

---

## Troubleshooting

### Container Won't Start

```bash
docker-compose logs <service-name>
docker-compose down
docker-compose up --build
```

### Database Connection Issues

```bash
docker-compose exec postgres psql -U postgres -d healthcare_dev
```

### Clear All Data

```bash
docker-compose down -v  # Warning: Removes all volumes
docker-compose up -d
```

---

## Frontend Deployment

### Build for Production

```bash
cd Frontend
npm run build
# Output in dist/ folder
```

### Serve Static Files

Deploy `dist/` folder to:
- AWS S3 + CloudFront
- Nginx
- Vercel/Netlify

---

*Last Updated: January 31, 2026*
