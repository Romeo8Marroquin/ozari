# Quick Deploy Reference

## TL;DR Cost-Optimized Deployment

```
SSM only (local dev):     $0/month
Infrastructure deployed:  $12.43/month
API auto-deploys:         $0/month (scales to zero)
```

---

## First Time Setup

### 1. Install GitHub CLI

```bash
# Windows (using winget)
winget install GitHub.cli

# Or download from https://cli.github.com/
```

### 2. Authenticate

```bash
gh auth login
```

### 3. Setup GitHub Secrets

Manually set secrets at: GitHub → Settings → Secrets and variables → Actions → Environments → dev

Required secrets:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `DB_PASSWORD`, `ADMIN_IP`, `APP_HOST`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`

(See DEPLOYMENT.md for details)

---

## Deployment Commands

### Deploy SSM Only (Free - For Local Dev)

**GitHub Actions:**
```
Actions → "Deploy SSM Parameters Only" → Run workflow
```

**Manual (Terraform):**
```bash
cd ozari-infra/stacks/dev
terraform init
terraform apply -var="deploy_local=true" ...
```

**Cost: $0/month**

---

### Deploy Infrastructure (Manual Only)

**GitHub Actions (Recommended):**
```
Actions → "Deploy Dev Environment" → Run workflow
  ☑ Deploy infrastructure (Network + RDS)
  → Infrastructure + API deploy automatically
```

**Result:**
- Network, RDS, and API all deployed
- **Cost: $12.43/month** starts accruing

**Manual (Advanced):**
```bash
cd ozari-infra/stacks/dev
terraform apply -var="deploy_local=false" ...
cd ../../ozari-api
serverless deploy --stage dev
```

---

### Update API Only (Auto on Push)

**Auto-deploy on code changes:**
```bash
git add ozari-api/
git commit -m "Update API"
git push origin dev
→ API auto-deploys (if infrastructure exists)
```

**Manual:**
```bash
cd ozari-api
serverless deploy --stage dev
```

**Cost: No change**
**Note:** Fails if infrastructure not deployed first

---

### Destroy Infrastructure (Save Money)

**GitHub Actions:**
```
Actions → "Destroy Dev Infrastructure" → Run workflow
  ☑ Remove API (Serverless functions)
  ☑ Destroy infrastructure (Network + RDS)
  Confirm: DESTROY
```

**Manual:**
```bash
# 1. Remove Serverless
cd ozari-api
serverless remove --stage dev

# 2. Destroy infrastructure (keep SSM)
cd ../ozari-infra/stacks/dev
terraform destroy \
  -target=module.network[0] \
  -target=module.db[0] \
  -auto-approve
```

**Savings: $12.43/month → $0/month**

---

## Workflow Decision Tree

```
┌─────────────────────────────┐
│  What do you want to do?    │
└─────────────────────────────┘
              │
      ┌───────┴───────┐
      │               │
  Work Locally    Deploy to AWS
      │               │
      ▼               ▼
  Deploy SSM   ┌──────────────┐
   (Free)      │ Need database?│
              └──────────────┘
                  │       │
                Yes      No
                  │       │
                  ▼       ▼
          Deploy Full  Just Deploy API
           Infrastructure (if DB exists)
           ($12/month)     ($0/month)
                  │
                  ▼
          ┌──────────────┐
          │ Done testing?│
          └──────────────┘
                  │
                 Yes
                  │
                  ▼
            Destroy Infrastructure
            (Back to $0/month)
```

---

## Common Scenarios

### Scenario: Daily Development (No Cost)

```bash
# One-time setup
# 1. Setup GitHub secrets manually (see above)
# 2. GitHub Actions → "Deploy SSM Parameters Only"

# Daily work
cd ozari-api
npm run dev  # Local development with AWS secrets
```

**Monthly cost: $0**

---

### Scenario: Weekend Testing Session

```
Friday:
  1. GitHub Actions → "Deploy Dev Environment"
     ☑ Infrastructure ☑ API
  2. Wait ~10 minutes for RDS to provision
  3. Test your features

Sunday:
  4. GitHub Actions → "Destroy Dev Infrastructure"
     ☑ Remove API ☑ Destroy Infrastructure
     Confirm: DESTROY

Cost: ~$1.20 for 3 days
```

---

### Scenario: Active Development (Budget)

```
# Deploy once
GitHub Actions → "Deploy Dev Environment" (full)

# Update code (auto-deploys on push)
git commit -am "Add feature"
git push origin dev

# Destroy on Friday evening, redeploy Monday morning
# Cost: ~$8/month (20 weekdays × $0.40/day)
```

---

### Scenario: Production Ready

```
# Keep infrastructure running 24/7
GitHub Actions → "Deploy Dev Environment" (once)

# All commits auto-deploy API
git push origin dev

# Consider Reserved Instance for 48% savings
Cost: $12.43/month (or $6.43 with RI)
```

---

## Monitoring Costs

### AWS Cost Explorer

```
AWS Console → Cost Management → Cost Explorer
Filter: Service = "RDS" or "Lambda"
```

### Expected Monthly Costs

| Service | Expected | Threshold to Investigate |
|---------|----------|--------------------------|
| RDS | $12.41 | > $13 |
| Lambda | $0 | > $1 |
| API Gateway | $0 | > $1 |
| SSM | $0 | > $0.10 |
| CloudWatch | $0 | > $0.50 |
| **Total** | **$12.43** | **> $15** |

---

## Troubleshooting

### Workflow Fails: "Parameter not found"

→ Deploy SSM first: "Deploy SSM Parameters Only"

### Database Connection Fails

→ Check security group allows your IP:
```bash
curl ifconfig.me  # Get your current IP
gh secret set ADMIN_IP --body "ADMIN_IP/32"
```

### Prisma Migrations Fail

→ Run manually:
```bash
cd ozari-api
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

### API Returns 502 Bad Gateway

→ Check Lambda logs:
```bash
serverless logs -f auth --stage dev --tail
```

---

## Cost Calculation Examples

### Example 1: Test 1 Day

```
Deploy:  9am Monday
Destroy: 6pm Monday
Duration: 9 hours

Cost: $12.43/month ÷ 730 hours = $0.017/hour
Total: 9 × $0.017 = $0.15
```

### Example 2: Test 1 Week

```
Deploy:  Monday
Destroy: Friday
Duration: 5 days = 120 hours

Cost: 120 × $0.017 = $2.04
```

### Example 3: Monthly Development

```
Deploy:  Weekdays only (20 days)
Destroy: Weekends (10 days saved)
Duration: 480 hours

Cost: 480 × $0.017 = $8.16/month
Savings: $4.27/month vs 24/7
```

---

## Next Steps

1. ✅ Setup GitHub secrets
2. ✅ Deploy SSM parameters
3. ✅ Test local development
4. When ready: Deploy full infrastructure
5. Test your app
6. Destroy infrastructure when done

Read full guide: [DEPLOYMENT.md](./DEPLOYMENT.md)
