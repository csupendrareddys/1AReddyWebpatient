# Elastic Beanstalk Deployment Guide

Complete guide for deploying the Healthcare Backend to AWS Elastic Beanstalk using Docker platform with GitHub Actions automation.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Environment Configuration](#environment-configuration)
4. [Local Testing](#local-testing)
5. [Elastic Beanstalk Setup](#elastic-beanstalk-setup)
6. [GitHub Actions Setup](#github-actions-setup)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

- **AWS CLI** - [Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **EB CLI** - Elastic Beanstalk CLI
- **Docker** - For local testing
- **Python 3.12+** - For running scripts

### AWS Resources

- ✅ RDS PostgreSQL instance (already configured)
- ElastiCache Redis instance (recommended for production)
- IAM roles:
  - `aws-elasticbeanstalk-service-role`
  - `aws-elasticbeanstalk-ec2-role`
- S3 buckets (already configured):
  - `jlmush-assests-public`
  - `jlmush-data-private`

### Install EB CLI

```powershell
# Using pip
pip install awsebcli

# Verify installation
eb --version
```

---

## Initial Setup

### 1. Configure AWS CLI

```powershell
aws configure
# Enter:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region: ap-south-2
# - Default output format: json
```

### 2. Verify RDS SSL Certificate

The SSL certificate should already be downloaded at `Backend/certs/global-bundle.pem`.

Verify:

```powershell
Test-Path Backend\certs\global-bundle.pem
# Should return: True
```

If missing, download:

```powershell
curl -o Backend\certs\global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

---

## Environment Configuration

### 1. Configure Production Environment

Edit `Backend/.env.production` and fill in the actual values:

**Required Changes:**

```bash
# 1. Set the RDS password
DATABASE_URL=postgresql://postgresjlmush1:YOUR_ACTUAL_PASSWORD@laraclinic.cna4qyum8pzl.ap-south-2.rds.amazonaws.com:5432/postgres?sslmode=verify-full&sslrootcert=/certs/global-bundle.pem

# 2. Generate new secret keys
# Run these commands to generate:
python -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(32))"
python -c "import secrets; print('JWT_SECRET_KEY=' + secrets.token_urlsafe(32))"
python -c "from cryptography.fernet import Fernet; print('ENCRYPTION_KEY=' + Fernet.generate_key().decode())"

# 3. Update Redis URL (if using ElastiCache)
REDIS_URL=redis://your-elasticache-endpoint:6379/0

# 4. Set production CORS origins
CORS_ORIGINS=https://yourdomain.com
```

**IMPORTANT:** Never commit `.env.production` to Git! It's already in `.gitignore`.

---

## Local Testing

### 1. Test RDS Connection

```powershell
cd Backend
python scripts\test_rds_connection.py
```

Expected output:

```
🔍 Testing RDS connection...
📍 Connection string: laraclinic.cna4qyum8pzl.ap-south-2.rds.amazonaws.com:5432
✅ Successfully connected to RDS database
📦 PostgreSQL version: PostgreSQL 16.x on x86_64-pc-linux-gnu
🔒 SSL connection verified
🧪 Test query result: 1 + 1 = 2

✅ All connection tests passed!
```

If connection fails:

- ✅ Check RDS security group allows your IP
- ✅ Verify DATABASE_URL password is correct
- ✅ Ensure RDS instance is publicly accessible (if connecting from local)

### 2. Test Docker Build

```powershell
cd Backend
docker build -t healthcare-backend:test .
```

Should complete without errors.

---

## Elastic Beanstalk Setup

### 1. Initialize EB Application

```powershell
# From project root (jlmushIITM)
eb init

# Follow prompts:
# - Select region: ap-south-2 (Asia Pacific - Hyderabad)
# - Application name: healthcare-backend
# - Platform: Docker
# - Platform version: Docker running on 64bit Amazon Linux 2023
# - SSH keypair: (optional, select or create if needed)
```

### 2. Create EB Environment

```powershell
eb create healthcare-prod

# Options:
# - Environment type: LoadBalanced
# - Instance type: t3.small (or t3.micro for testing)
# - Service role: aws-elasticbeanstalk-service-role
```

This will:

- Create EC2 instances
- Set up Application Load Balancer
- Configure Auto Scaling group
- Deploy initial version

**Wait 5-10 minutes** for environment creation.

### 3. Set Environment Variables

Set sensitive environment variables via EB Console or CLI:

```powershell
# Set all required variables at once
eb setenv `
  FLASK_ENV=production `
  DATABASE_URL="YOUR_FULL_DATABASE_URL" `
  SECRET_KEY="YOUR_SECRET_KEY" `
  JWT_SECRET_KEY="YOUR_JWT_SECRET_KEY" `
  ENCRYPTION_KEY="YOUR_ENCRYPTION_KEY" `
  REDIS_URL="redis://your-elasticache:6379/0" `
  CORS_ORIGINS="https://yourdomain.com" `
  AWS_ACCESS_KEY_ID="<KEY-ID-REDACTED-ROTATED>" `
  AWS_SECRET_ACCESS_KEY="YOUR_SECRET" `
  AWS_S3_REGION="ap-south-2" `
  AWS_S3_PUBLIC_BUCKET="jlmush-assests-public" `
  AWS_S3_PRIVATE_BUCKET="jlmush-data-private"
```

**Alternative: Use EB Console**

1. Go to AWS Console → Elastic Beanstalk
2. Select `healthcare-prod` environment
3. Configuration → Software → Environment properties
4. Add all variables from `.env.production`

### 4. Configure Security Groups

**RDS Security Group:**

- Add inbound rule allowing PostgreSQL (5432) from EB security group

**ElastiCache Security Group** (if using):

- Add inbound rule allowing Redis (6379) from EB security group

---

## GitHub Actions Setup

### 1. Add GitHub Secrets

Go to GitHub repository → Settings → Secrets and variables → Actions

Add these secrets:

- `AWS_ACCESS_KEY_ID` - Your AWS access key
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key

### 2. Verify Workflow

The workflow file is already created at `.github/workflows/deploy-eb.yml`.

It will:

1. ✅ Build Docker image on every push to `main`
2. ✅ Verify SSL certificate exists
3. ✅ Create deployment package
4. ✅ Deploy to Elastic Beanstalk
5. ✅ Run health checks

### 3. Test Workflow

**Manual trigger:**

```
GitHub → Actions → "Deploy to Elastic Beanstalk" → Run workflow
```

**Automatic trigger:**
Push to `main` branch with changes in:

- `Backend/**`
- `Dockerrun.aws.json`
- `.ebextensions/**`

---

## Deployment

### Method 1: GitHub Actions (Recommended)

1. Commit and push changes:

```powershell
git add .
git commit -m "Deploy: Production configuration"
git push origin main
```

2. Monitor deployment:

```
GitHub → Actions → View workflow run
```

3. Check EB environment:

```powershell
eb status
eb health
```

### Method 2: Manual EB CLI Deployment

```powershell
# From project root
eb deploy

# With custom version label
eb deploy --label "v1.0.0"

# Monitor logs
eb logs --stream
```

---

## Post-Deployment

### 1. Verify Health

```powershell
# Get environment URL
eb status

# Test health endpoint
curl http://healthcare-prod.ap-south-2.elasticbeanstalk.com/health
# Should return: {"status":"healthy"}
```

### 2. Test Database Connection

```powershell
# SSH into EB instance (if keypair configured)
eb ssh

# Inside instance
docker ps
docker logs <container-id>
```

### 3. Monitor Application

```powershell
# Stream logs
eb logs --stream

# View recent logs
eb logs

# Check environment health
eb health --refresh
```

---

## Troubleshooting

### Issue: Docker build fails

**Symptoms:**

```
ERROR: failed to solve: failed to compute cache key
```

**Solution:**

```powershell
# Verify SSL certificate exists
Test-Path Backend\certs\global-bundle.pem

# If missing, download
curl -o Backend\certs\global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Rebuild
docker build -t healthcare-backend Backend/
```

### Issue: Database connection refused

**Symptoms:**

```
psycopg2.OperationalError: could not connect to server
```

**Solution:**

1. Check RDS security group:
   ```powershell
   aws ec2 describe-security-groups --group-ids sg-xxxxx
   ```
2. Verify DATABASE_URL is set:
   ```powershell
   eb printenv | Select-String DATABASE_URL
   ```
3. Test from EB instance:
   ```powershell
   eb ssh
   curl -v telnet://laraclinic.cna4qyum8pzl.ap-south-2.rds.amazonaws.com:5432
   ```

### Issue: SSL certificate verification failed

**Symptoms:**

```
SSL error: certificate verify failed
```

**Solution:**

1. Verify certificate is copied in Dockerfile:
   ```dockerfile
   COPY certs/global-bundle.pem /certs/global-bundle.pem
   ```
2. Check DATABASE_URL has correct SSL parameters:
   ```
   ?sslmode=verify-full&sslrootcert=/certs/global-bundle.pem
   ```

### Issue: Environment variables not set

**Symptoms:**

```
RuntimeError: Missing required environment variables: DATABASE_URL
```

**Solution:**

```powershell
# List current environment variables
eb printenv

# Set missing variables
eb setenv DATABASE_URL="postgresql://..."
```

### Issue: Health check failing

**Symptoms:** EB dashboard shows "Degraded" or "Severe"

**Solution:**

1. Check application logs:
   ```powershell
   eb logs
   ```
2. Verify health endpoint:
   ```powershell
   eb ssh
   curl http://localhost:5000/health
   ```
3. Check health check configuration in `.ebextensions/02_environment.config`

---

## Useful Commands

### EB CLI Reference

```powershell
# Environment status
eb status

# View logs
eb logs
eb logs --stream

# SSH into instance
eb ssh

# Open environment in browser
eb open

# List environments
eb list

# Terminate environment
eb terminate healthcare-prod

# View environment health
eb health
eb health --refresh

# Set environment variables
eb setenv KEY=VALUE

# Print environment variables
eb printenv
```

### Docker Commands

```powershell
# Build image
docker build -t healthcare-backend Backend/

# Run locally
docker run -p 5000:5000 --env-file Backend/.env.production healthcare-backend

# View logs
docker logs <container-id>

# Shell into container
docker exec -it <container-id> /bin/bash
```

---

## Production Checklist

Before going live:

- [ ] RDS password set in environment variables
- [ ] New SECRET_KEY, JWT_SECRET_KEY generated
- [ ] New ENCRYPTION_KEY generated
- [ ] ElastiCache Redis configured and URL set
- [ ] CORS_ORIGINS set to production domain
- [ ] RDS security group allows EB instances
- [ ] ElastiCache security group allows EB instances
- [ ] SSL certificate (HTTPS) configured on ALB
- [ ] Custom domain configured
- [ ] Database migrations applied
- [ ] Health check endpoint responding
- [ ] Monitoring/alerting configured (CloudWatch)
- [ ] Backup strategy implemented (RDS snapshots)
- [ ] GitHub Actions secrets configured
- [ ] Test deployment via GitHub Actions

---

## Additional Resources

- [AWS Elastic Beanstalk Documentation](https://docs.aws.amazon.com/elasticbeanstalk/)
- [EB CLI Reference](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/eb-cli3.html)
- [Docker Platform Guide](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/docker-singlecontainer-deploy.html)
- [RDS Security Best Practices](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.Security.html)

---

## Getting Help

If you encounter issues:

1. **Check EB logs:** `eb logs --stream`
2. **View environment events:** AWS Console → EB → Events
3. **Review CloudWatch logs:** AWS Console → CloudWatch → Log groups
4. **Test locally:** Use Docker Compose with production settings
5. **AWS Support:** For infrastructure issues

**Emergency Rollback:**

```powershell
# If deployment breaks production
eb deploy --version <previous-version-label>
```
