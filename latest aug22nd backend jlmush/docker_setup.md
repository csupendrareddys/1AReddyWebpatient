# 🐳 Docker Setup Guide - Healthcare Backend

A beginner-friendly guide to running the Healthcare Backend using Docker.

---

## 📋 Prerequisites

### 1. Install Docker Desktop

**Windows:**
1. Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
2. Run the installer (enable WSL 2 if prompted)
3. Restart your computer
4. Open Docker Desktop and wait for it to start (green icon in system tray)

**Mac:**
1. Download [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop)
2. Drag to Applications folder
3. Open Docker and wait for it to start

**Verify Installation:**
```powershell
docker --version
docker-compose --version
```

---

## 🚀 Quick Start (3 Commands)

```powershell
# 1. Generate encryption key and create .env file
python -c "from cryptography.fernet import Fernet; print('ENCRYPTION_KEY=' + Fernet.generate_key().decode())" > .env

# 2. Add required variables to .env
# Edit .env file and add:
# SECRET_KEY=your-secret-key
# JWT_SECRET_KEY=your-jwt-secret

# 3. Start everything
docker-compose up --build
```

That's it! Your API is running at `http://localhost:5000`

---

## 📖 Step-by-Step Guide

### Step 1: Create Environment File

Copy the example file:
```powershell
copy .env.example .env
```

### Step 2: Generate Encryption Key

Run this command to generate a secure encryption key:
```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Copy the output and paste it as `ENCRYPTION_KEY` in your `.env` file.

### Step 3: Edit .env File

Open `.env` in a text editor and set these **required** values:
```env
ENCRYPTION_KEY=<paste-your-generated-key-here>
SECRET_KEY=my-super-secret-key-12345
JWT_SECRET_KEY=my-jwt-secret-key-67890
```

### Step 4: Start the Application

```powershell
docker-compose up --build
```

Wait for all services to show "healthy" status. You'll see:
```
healthcare-postgres  | ... database system is ready to accept connections
healthcare-redis     | ... Ready to accept connections
healthcare-backend   | ✅ Startup complete!
healthcare-backend   | 🌐 Starting Gunicorn server on port 5000...
```

### Step 5: Test the API

Health check:
```powershell
curl http://localhost:5000/health
```

Expected response:
```json
{"status": "healthy", "message": "Healthcare API is running"}
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR COMPUTER                           │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Browser   │  │   Postman   │  │    Frontend App     │ │
│  │             │  │             │  │ (localhost:3000)    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                    │            │
│         └────────────────┼────────────────────┘            │
│                          │                                 │
│                          ▼                                 │
│  ┌─────────────────────────────────────────────────────┐  │
│  │        DOCKER CONTAINER: healthcare-backend         │  │
│  │                  Port 5000                          │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │              Flask + Gunicorn                 │  │  │
│  │  │                                               │  │  │
│  │  │  • /auth/* - Authentication endpoints        │  │  │
│  │  │  • /api/*  - API endpoints                   │  │  │
│  │  │  • /health - Health check                    │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  │              │                    │                │  │
│  └──────────────┼────────────────────┼────────────────┘  │
│                 │                    │                    │
│     ┌───────────▼───────┐   ┌────────▼─────────┐         │
│     │  healthcare-postgres│  │ healthcare-redis │         │
│     │     Port 5432     │   │    Port 6379     │         │
│     │                   │   │                   │         │
│     │  • User data      │   │  • Session cache │         │
│     │  • Sessions       │   │  • Rate limits   │         │
│     │  • All tables     │   │                   │         │
│     └───────────────────┘   └───────────────────┘         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🔐 API Testing Examples

### 1. Sign Up (Create Account)

```powershell
curl -X POST http://localhost:5000/auth/signup `
  -H "Content-Type: application/json" `
  -d '{
    "email": "doctor@example.com",
    "phone_number": "9876543210",
    "password": "SecurePass123!",
    "first_name": "John",
    "last_name": "Doe",
    "role": "doctor"
  }'
```

**Available roles:** `patient`, `doctor`, `super_admin`, `sub_admin`, `pharmacy`, `diagnosis`

### 2. Sign In (Login)

```powershell
curl -X POST http://localhost:5000/auth/signin `
  -H "Content-Type: application/json" `
  -c cookies.txt `
  -d '{
    "email": "doctor@example.com",
    "password": "SecurePass123!"
  }'
```

The `-c cookies.txt` saves the authentication cookies.

### 3. Get Profile (Protected Route)

```powershell
curl http://localhost:5000/auth/me `
  -b cookies.txt
```

### 4. List Active Sessions

```powershell
curl http://localhost:5000/auth/sessions `
  -b cookies.txt
```

### 5. Logout

```powershell
curl -X POST http://localhost:5000/auth/logout `
  -b cookies.txt
```

---

## ⚙️ Configuration

### Changing Session Limit

By default, only **1 session per user** is allowed. To change this:

1. Open `config.py`
2. Find `MAX_SESSIONS_PER_USER = 1`
3. Change to your desired number
4. Rebuild: `docker-compose up --build`

### Changing Token Expiry

Preferred: set env vars (no code change, works per-environment). Unset/blank/
invalid/<=0 falls back to the default, so a typo can't produce a near-zero expiry.
```bash
JWT_ACCESS_TOKEN_EXPIRES_MINUTES=60   # e.g. 60 = 1-hour access token
JWT_REFRESH_TOKEN_EXPIRES_DAYS=10
```
Env changes need the container **recreated** (not just `docker restart`) so the
new `--env-file` is read. Defaults live in `config.py`:
```python
# base/prod default: access = 10 min, refresh = 10 days  (dev: 30 min / 12 h)
JWT_ACCESS_TOKEN_EXPIRES = _token_lifetime('JWT_ACCESS_TOKEN_EXPIRES_MINUTES', 'minutes', timedelta(minutes=10))
JWT_REFRESH_TOKEN_EXPIRES = _token_lifetime('JWT_REFRESH_TOKEN_EXPIRES_DAYS', 'days', timedelta(days=10))
SESSION_HARD_LIMIT_DAYS = 30                       # Max session lifetime
```

---

## 🛠️ Common Commands

| Command | Description |
|---------|-------------|
| `docker-compose up` | Start all services |
| `docker-compose up --build` | Rebuild and start |
| `docker-compose down` | Stop all services |
| `docker-compose down -v` | Stop and delete all data |
| `docker-compose logs backend` | View backend logs |
| `docker-compose logs -f` | Follow all logs |
| `docker exec -it healthcare-backend bash` | Shell into backend |
| `docker exec -it healthcare-postgres psql -U postgres -d healthcare_dev` | PostgreSQL shell |
| `docker exec -it healthcare-redis redis-cli` | Redis shell |

---

## 🔧 Troubleshooting

### "ENCRYPTION_KEY environment variable is not set"

Generate and set the key:
```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Copy output and add to .env file
```

### "Port 5000 is already in use"

Change the port in `.env`:
```env
BACKEND_PORT=5001
```

### "Cannot connect to PostgreSQL"

1. Make sure Docker Desktop is running
2. Wait for PostgreSQL health check to pass
3. Check logs: `docker-compose logs postgres`

### Database connection refused

The backend waits for PostgreSQL to be ready. If it's still failing:
```powershell
docker-compose down
docker-compose up --build
```

### Redis connection error

Check Redis is running:
```powershell
docker exec -it healthcare-redis redis-cli ping
# Should return: PONG
```

---

## 📁 File Structure

```
Backend/
├── app/
│   ├── auth/
│   │   ├── route.py           # Auth endpoints
│   │   ├── service.py         # Auth business logic
│   │   ├── session_store.py   # Redis session management
│   │   └── AUTH_MODULE_GUIDE.md
│   ├── common/
│   │   ├── encryption.py      # AES-256 encryption
│   │   └── decorators.py      # @require_role(), etc.
│   └── extensions.py          # Flask extensions
├── config.py                  # All configuration
├── model.py                   # Database models
├── Dockerfile
├── docker-compose.yml
├── docker-entrypoint.sh
├── .env.example
└── docker_setup.md            # This file
```

---

## 🎉 Next Steps

1. **Test all auth endpoints** using the examples above
2. **Create a test user** for each role
3. **Connect your frontend** to `http://localhost:5000`
4. **Check out** `AUTH_MODULE_GUIDE.md` for developer documentation
