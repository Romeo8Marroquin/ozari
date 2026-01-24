# Ozari Deployment Guide

## Overview

This project uses **GitHub Actions** for automated deployments with **cost-optimized toggleable infrastructure**.

### Cost Breakdown

| Component | Cost | Status |
|-----------|------|--------|
| SSM Parameter Store | $0/month | Always deployed |
| Lambda + API Gateway | $0/month | Auto-scales to zero |
| RDS db.t4g.micro + Network | $12.43/month | **Toggleable** |

## Quick Start

### 1. Setup GitHub Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions → Environments → dev

Add the following secrets (generate secure random values):

- `AWS_ACCESS_KEY_ID` - Your AWS access key
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key
- `DB_PASSWORD` - Strong random password for RDS
- `ADMIN_IP` - Your IP address in CIDR format (e.g., `203.0.113.45/32`)
- `APP_HOST` - Frontend URL (e.g., `http://localhost:5173`)
- `JWT_SECRET` - 64-character random hex string
- `JWT_REFRESH_SECRET` - 64-character random hex string
- `ENCRYPTION_KEY` - 64-character random hex string (32 bytes)

**Note:** DATABASE_URL is automatically created by Terraform and stored in SSM Parameter Store.

### 2. Initial Setup (Free - SSM Only)

This deploys only SSM parameters for local development:

```bash
# Runs automatically on push to dev, or trigger manually
GitHub Actions → Deploy SSM Parameters Only → Run workflow
```

**Result:** You can now develop locally with AWS secrets.

### 3. Deploy Infrastructure (Costs Money) - Manual Only

When you're ready to test with real infrastructure:

```bash
GitHub Actions → Deploy Dev Environment → Run workflow
  ☑ Deploy infrastructure (Network + RDS) - Check this
  Click "Run workflow"
```

**Result:**
- ✅ VPC + Subnets + Security Groups deployed
- ✅ RDS PostgreSQL database created
- ✅ Lambda functions deployed automatically after infrastructure
- ⚠️ **Costing $12.43/month**

**Important:** Infrastructure deployment is manual only (never auto-deploys on push).

### 4. Auto-Deploy API on Code Changes

After infrastructure exists, push code changes to auto-deploy API:

```bash
git add .
git commit -m "Update API"
git push origin dev
```

**Result:**
- ✅ Lambda functions updated automatically
- ✅ No infrastructure changes (network/DB unchanged)
- ❌ Fails if infrastructure not deployed (must run step 3 first)

### 5. Destroy Infrastructure (Save Money)

When you're done testing:

```bash
GitHub Actions → Destroy Dev Infrastructure → Run workflow
  ☑ Remove API (Serverless functions)
  ☑ Destroy infrastructure (Network + RDS)
  Confirm: DESTROY
  Click "Run workflow"
```

**Result:**
- ✅ RDS + Network destroyed
- ✅ SSM parameters preserved (for local dev)
- ✅ **Saving $12.43/month**

---

## Deployment Scenarios

### Scenario 1: Daily Development (Free)

```
1. Work on code locally
2. Use SSM parameters from AWS
3. Connect to local PostgreSQL or mock DB
4. Cost: $0/month
```

### Scenario 2: Weekly Testing (Budget-Friendly)

```
Monday:
1. Deploy infrastructure ($12.43/month prorated = ~$0.40/day)
2. Deploy API
3. Test features for 2-3 days

Thursday:
4. Destroy infrastructure
5. Total cost: ~$1.20 for 3 days
```

### Scenario 3: Production-Ready (Full Cost)

```
1. Deploy infrastructure (keep running)
2. Auto-deploy API on every commit
3. Cost: $12.43/month
```

---

## Workflow Reference

### `deploy-dev.yml`

**Triggers:**
- Manual: Full control over infra + API deployment
- Auto: Push to `dev` branch (API only, no infra)

**Use cases:**
- Deploy full environment for testing
- Update API code without touching infra

### `destroy-dev.yml`

**Triggers:**
- Manual only (requires "DESTROY" confirmation)

**Use cases:**
- Save money when not actively testing
- Clean up after feature testing

### `deploy-ssm-only.yml`

**Triggers:**
- Manual or auto (when SSM module changes)

**Use cases:**
- Initial setup for local development
- Update secrets without deploying infra

---

## Local Development Setup

### 1. Deploy SSM Parameters

```bash
# Via GitHub Actions (recommended)
GitHub Actions → Deploy SSM Parameters Only → Run workflow

# Or manually with Terraform
cd ozari-infra/stacks/dev
terraform init
terraform apply -var="deploy_local=true" \
  -var="profile=terraform-profile" \
  -var="environment=dev" \
  -var="app_host=http://localhost:5173" \
  -var="jwt_secret=YOUR_SECRET" \
  -var="jwt_refresh_secret=YOUR_REFRESH_SECRET" \
  -var="encryption_key=YOUR_ENCRYPTION_KEY" \
  -var="db_password=dummy" \
  -var="admin_ip=0.0.0.0/0" \
  -target=module.ssm
```

### 2. Run API Locally

```bash
cd ozari-api

# Install dependencies
npm install

# Setup local PostgreSQL (or use Docker)
docker run -d \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ozari_db \
  postgres:16-alpine

# Create .env file
cat > .env << EOF
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ozari_db?schema=public
API_ENV=dev
LOG_LEVEL=debug
APP_HOST=http://localhost:5173
API_PORT=3000
AWS_REGION=us-east-1
PROFILE=default
EOF

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Start dev server
npm run dev
```

### 3. Run Frontend Locally

```bash
cd ozari-app

# Create .env file
echo "VITE_API_URL=http://localhost:3000" > .env

# Install and run
npm install
npm run dev
```

---

## Cost Optimization Tips

### 1. Use Scheduled Workflows (Advanced)

Create a scheduled workflow to auto-destroy infrastructure on weekends:

```yaml
# .github/workflows/schedule-destroy.yml
on:
  schedule:
    - cron: '0 18 * * 5'  # Every Friday at 6 PM UTC
```

### 2. RDS Snapshots Before Destroy

Modify the destroy workflow to create a snapshot:

```bash
aws rds create-db-snapshot \
  --db-instance-identifier ozari-db-dev \
  --db-snapshot-identifier ozari-dev-$(date +%Y%m%d)
```

Snapshots cost ~$0.095/GB/month (cheaper than running RDS).

### 3. Reserved Instances (If Always Running)

If you decide to keep dev running 24/7:

```bash
# 1-year reserved instance: ~$6.43/month (48% savings)
aws rds purchase-reserved-db-instances-offering \
  --reserved-db-instances-offering-id <offering-id>
```

---

## Troubleshooting

### GitHub Actions Fails: "Error acquiring state lock"

**Cause:** Terraform state is locked by another workflow.

**Fix:**
```bash
# Unlock manually
cd ozari-infra/stacks/dev
terraform force-unlock <LOCK_ID>
```

### Serverless Deploy Fails: "Cannot find SSM parameter"

**Cause:** Infrastructure not deployed yet.

**Fix:** Run "Deploy Dev Environment" with infrastructure enabled.

### Prisma Migrations Fail

**Cause:** Database not accessible.

**Fix:** Check security group allows GitHub Actions IP, or use VPN.

---

## Production Deployment

For production (when ready):

1. Create `ozari-infra/stacks/prod/` directory
2. Copy dev config and update variables
3. Create separate GitHub secrets with `PROD_` prefix
4. Create `.github/workflows/deploy-prod.yml`
5. Use separate branch protection (e.g., `main` branch)
6. Consider:
   - Multi-AZ RDS for high availability
   - CloudFront CDN for frontend
   - Route53 for custom domain
   - ACM for SSL certificates
   - CloudWatch alarms

**Production infrastructure should stay deployed 24/7.**

---

## Questions?

- Workflows not triggering? Check `.github/workflows/` file paths
- Secrets not working? Verify secret names match exactly
- Terraform errors? Check AWS credentials and IAM permissions
- Cost concerns? Use destroy workflow after testing

Happy deploying! 🚀
