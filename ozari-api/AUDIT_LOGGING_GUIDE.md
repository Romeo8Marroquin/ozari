# Audit Logging & Database Query Monitoring Guide

## 📋 Table of Contents

1. [Overview](#overview)
2. [Audit Logging](#audit-logging)
3. [Database Query Logging](#database-query-logging)
4. [Searching Logs in Railway](#searching-logs-in-railway)
5. [Usage Examples](#usage-examples)
6. [Best Practices](#best-practices)

---

## 🎯 Overview

**Implemented Features:**

✅ **Audit Logging** - Track security-critical events (login, logout, user creation, etc.)
✅ **Database Query Logging** - Monitor query performance and detect slow queries
✅ **Railway-Optimized** - Structured JSON logs for easy searching in Railway dashboard
✅ **Production-Only Audit** - Audit logs only in production (no noise in development)
✅ **Automatic Integration** - Already integrated into auth module

---

## 🔒 Audit Logging

### **What is Logged (Production Only)**

All audit logs have the prefix `[AUDIT]` and are logged only when `NODE_ENV=production`.

**Currently Tracked Events:**

| Event | Action | When |
|-------|--------|------|
| User Created | `USER_CREATED` | New user registration |
| Login Success | `USER_LOGIN_SUCCESS` | Successful authentication |
| Login Failed | `USER_LOGIN_FAILED` | Invalid credentials or user not found |
| Account Locked | `ACCOUNT_LOCKED` | Too many failed login attempts (5 in 15 min) |
| Token Refresh | `TOKEN_REFRESH` | Access token refreshed |
| User Logout | `USER_LOGOUT` | User logged out (single device) |
| Logout All Devices | `USER_LOGOUT_ALL_DEVICES` | User logged out from all devices |

**Additional Events Available (for future use):**

- `USER_DELETED`, `USER_UPDATED`, `USER_ROLE_CHANGED`
- `PASSWORD_CHANGED`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`
- `MFA_ENABLED`, `MFA_DISABLED`
- `UNAUTHORIZED_ACCESS_ATTEMPT`, `API_KEY_ROTATED`
- `SENSITIVE_DATA_ACCESSED`, `SENSITIVE_DATA_EXPORTED`
- `ADMIN_ACTION`, `PERMISSION_GRANTED`, `PERMISSION_REVOKED`

### **Audit Log Structure**

**Production (Railway):**
```json
{
  "level": "info",
  "message": "USER_LOGIN_SUCCESS - SUCCESS",
  "timestamp": "2026-02-05 14:32:15",
  "service": "ozari-api",
  "type": "audit",
  "label": "[AUDIT]",
  "userId": 123,
  "email": "user@example.com",
  "ipAddress": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "deviceUuid": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Development (Console):**
```
2026-02-05 14:32:15 [AUDIT] INFO: USER_LOGIN_SUCCESS - SUCCESS
{
  "userId": 123,
  "email": "user@example.com",
  "ipAddress": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "deviceUuid": "550e8400-e29b-41d4-a716-446655440000"
}
```

### **How to Use in Code**

**Example 1: Log User Creation**
```typescript
import { AuditAction, logUserManagementAudit } from '@/config/auditLogger.js';

// After creating user
if (process.env["NODE_ENV"] === "production") {
  logUserManagementAudit({
    action: AuditAction.USER_CREATED,
    userId: newUser.id,
    email: user.email,
    ipAddress: req.ip,
    success: true,
  });
}
```

**Example 2: Log Authentication Event**
```typescript
import { AuditAction, logAuthAudit } from '@/config/auditLogger.js';

// After successful login
if (process.env["NODE_ENV"] === "production") {
  logAuthAudit({
    action: AuditAction.USER_LOGIN_SUCCESS,
    userId: user.id,
    email: user.email,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    deviceUuid: deviceUuid,
    success: true,
  });
}

// After failed login
if (process.env["NODE_ENV"] === "production") {
  logAuthAudit({
    action: AuditAction.USER_LOGIN_FAILED,
    email: email,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    deviceUuid: deviceUuid,
    success: false,
    reason: "Invalid password",
  });
}
```

**Example 3: Log Security Event**
```typescript
import { AuditAction, logSecurityAudit } from '@/config/auditLogger.js';

if (process.env["NODE_ENV"] === "production") {
  logSecurityAudit({
    action: AuditAction.ACCOUNT_LOCKED,
    email: user.email,
    ipAddress: req.ip,
    success: true,
    reason: "Too many failed login attempts",
    metadata: {
      attempts: 5,
      remainingMinutes: 15,
    },
  });
}
```

---

## 💾 Database Query Logging

### **What is Logged**

**Development Mode (`NODE_ENV=development`):**
- **ALL queries** logged at `DEBUG` level
- Includes query text, parameters, duration, target

**Production Mode (`NODE_ENV=production`):**
- **Only slow queries** (>500ms) logged at `WARN` level
- Helps identify performance bottlenecks

### **Log Examples**

**Development (All Queries):**
```
2026-02-05 14:32:15 DEBUG: Database Query
{
  "query": "SELECT * FROM users WHERE emailSha = $1",
  "params": "[\\"abc123...\\"]",
  "duration": "12ms",
  "target": "postgres"
}
```

**Production (Slow Queries):**
```
2026-02-05 14:32:15 WARN: Slow database query detected
{
  "query": "SELECT * FROM products JOIN categories...",
  "duration": "1250ms",
  "target": "postgres",
  "threshold": "500ms"
}
```

### **Configuration**

Located in `src/services/prisma.service.ts`:

```typescript
const slowQueryThreshold = 500; // ms - queries slower than this are logged
```

**To adjust the threshold:**
1. Edit `src/services/prisma.service.ts`
2. Change `slowQueryThreshold` value (e.g., 1000 for 1 second)
3. Redeploy to Railway

---

## 🔍 Searching Logs in Railway

Railway provides a centralized log viewer for all your services. Here's how to find and filter audit logs.

### **Access Railway Logs**

1. Go to [railway.app](https://railway.app)
2. Select your project
3. Click on your `ozari-api` service
4. Click **"Deployments"** tab
5. Click on the latest deployment
6. Click **"View Logs"** button

### **Search Examples**

#### **1. Find All Audit Logs**
```
[AUDIT]
```
This shows all audit events (user creation, login, logout, etc.)

#### **2. Find Specific Event Type**
```
USER_LOGIN_SUCCESS
```
Shows all successful logins

```
USER_LOGIN_FAILED
```
Shows all failed login attempts

```
ACCOUNT_LOCKED
```
Shows all account lockouts (brute-force protection)

#### **3. Find Logs for Specific User**
```
[AUDIT] userId: 123
```
Shows all audit events for user ID 123

```
[AUDIT] email: "user@example.com"
```
Shows all audit events for specific email

#### **4. Find Logs from Specific IP**
```
[AUDIT] ipAddress: "192.168.1.1"
```
Shows all audit events from specific IP (useful for investigating suspicious activity)

#### **5. Find Slow Database Queries**
```
Slow database query detected
```
Shows queries that took longer than 500ms

#### **6. Combine Filters**
```
[AUDIT] USER_LOGIN_FAILED ipAddress: "192.168.1.1"
```
Shows failed login attempts from specific IP

### **Railway Log Filtering Tips**

- **Case-sensitive:** Railway search is case-sensitive
- **Partial matches:** Search finds partial text matches
- **JSON fields:** You can search by any JSON field in structured logs
- **Time range:** Use Railway's time picker to narrow down results
- **Download:** Export logs for external analysis (JSON or CSV)

---

## 📖 Usage Examples

### **Scenario 1: Investigate Failed Login**

**Problem:** User reports they can't log in

**Steps:**
1. Search Railway logs: `[AUDIT] USER_LOGIN_FAILED email: "user@example.com"`
2. Check if account is locked: `[AUDIT] ACCOUNT_LOCKED email: "user@example.com"`
3. Review IP addresses and user-agents to identify suspicious activity
4. Check database logs for connection issues

**What to look for:**
- Multiple failed attempts from different IPs (credential stuffing attack)
- Account locked due to too many attempts
- Database connection errors

---

### **Scenario 2: Detect Suspicious Login Activity**

**Problem:** Unusual login patterns detected

**Steps:**
1. Search for successful logins: `[AUDIT] USER_LOGIN_SUCCESS`
2. Filter by time range (e.g., last 24 hours)
3. Look for:
   - Logins from unusual locations (check IP addresses)
   - Multiple device UUIDs for same user
   - Login success after many failed attempts

**What to look for:**
```json
{
  "action": "USER_LOGIN_SUCCESS",
  "userId": 123,
  "ipAddress": "203.0.113.45",  // Foreign IP
  "deviceUuid": "new-device-uuid"  // Never seen before
}
```

---

### **Scenario 3: Performance Debugging**

**Problem:** API is slow

**Steps:**
1. Search for slow queries: `Slow database query detected`
2. Review query duration and frequency
3. Identify problematic queries
4. Add indexes or optimize queries

**Example slow query:**
```json
{
  "query": "SELECT * FROM services JOIN products...",
  "duration": "2500ms",
  "threshold": "500ms"
}
```

**Action:** Add index on join column or optimize query.

---

### **Scenario 4: Compliance Audit**

**Problem:** Need to provide audit trail for security review

**Steps:**
1. Export Railway logs for date range
2. Filter by audit events: `[AUDIT]`
3. Generate report showing:
   - User creation events
   - Login/logout events
   - Failed authentication attempts
   - Account lockouts

**Railway Export:**
1. Click "Download Logs" in Railway dashboard
2. Select date range
3. Choose JSON format
4. Use `jq` or similar to filter and format

```bash
# Filter audit logs from exported JSON
cat railway-logs.json | jq 'select(.message | contains("[AUDIT]"))'
```

---

## ✅ Best Practices

### **1. Only Log in Production**
```typescript
// Always wrap audit logs with environment check
if (process.env["NODE_ENV"] === "production") {
  logAuthAudit({...});
}
```

**Why:** Audit logs add overhead and clutter in development.

---

### **2. Include Context**
```typescript
// Good: Includes IP, user-agent, device UUID
logAuthAudit({
  action: AuditAction.USER_LOGIN_SUCCESS,
  userId: user.id,
  email: user.email,
  ipAddress: req.ip,           // ✅ Include
  userAgent: req.headers["user-agent"],  // ✅ Include
  deviceUuid: deviceUuid,      // ✅ Include
  success: true,
});

// Bad: Missing context
logAuthAudit({
  action: AuditAction.USER_LOGIN_SUCCESS,
  userId: user.id,
  success: true,
});
```

**Why:** More context = easier investigation.

---

### **3. Log Both Success and Failure**
```typescript
// Log success
logAuthAudit({ action: AuditAction.USER_LOGIN_SUCCESS, success: true });

// Log failure
logAuthAudit({
  action: AuditAction.USER_LOGIN_FAILED,
  success: false,
  reason: "Invalid password"  // ✅ Include reason
});
```

**Why:** Failed events are often more important for security.

---

### **4. Monitor Slow Queries Regularly**

**Set up alerts in Railway:**
1. Go to your service settings
2. Set up notification webhooks
3. Alert on "Slow database query" warnings

**Action items:**
- Review slow queries weekly
- Add database indexes where needed
- Optimize N+1 queries

---

### **5. Protect Sensitive Data**

**DO NOT log:**
- Passwords (plain or hashed)
- Credit card numbers
- API keys or secrets
- Full OAuth tokens

**Example:**
```typescript
// Bad ❌
logAudit({
  action: AuditAction.PASSWORD_CHANGED,
  oldPassword: oldPassword,  // ❌ NEVER
  newPassword: newPassword,  // ❌ NEVER
});

// Good ✅
logAudit({
  action: AuditAction.PASSWORD_CHANGED,
  userId: user.id,
  success: true,
});
```

**Why:** Logs are often exported and analyzed by external tools.

---

### **6. Review Audit Logs Regularly**

**Weekly:**
- Check for unusual login patterns
- Review failed login attempts
- Monitor account lockouts

**Monthly:**
- Export logs for compliance
- Analyze user activity trends
- Identify security improvements

**Ad-hoc:**
- After security incidents
- When users report issues
- During security audits

---

## 🚀 Next Steps

### **Already Implemented:**
✅ Audit logging in auth module
✅ Database query logging
✅ Railway-optimized structured logging
✅ Production-only audit logs

### **To Add Audit Logging to New Modules:**

1. Import audit logger:
```typescript
import { AuditAction, logAudit } from '@/config/auditLogger.js';
```

2. Add audit log at critical points:
```typescript
if (process.env["NODE_ENV"] === "production") {
  logAudit({
    action: AuditAction.YOUR_ACTION,
    userId: user.id,
    success: true,
    // ... other fields
  });
}
```

3. Deploy to Railway

4. Verify in Railway logs: `[AUDIT] YOUR_ACTION`

---

## 📞 Support

**Questions?**
- Review `src/config/auditLogger.ts` for all available audit actions
- Check `src/services/prisma.service.ts` for query logging configuration
- See `src/modules/auth/auth.controller.ts` for usage examples

**Railway Logs Not Showing?**
- Verify `NODE_ENV=production` is set in Railway environment variables
- Check Railway deployment logs for errors
- Ensure service is running (green status)

---

## 🎉 Summary

**Audit logging is now production-ready!**

✅ All authentication events tracked
✅ Security events monitored
✅ Database performance monitored
✅ Easy to search in Railway
✅ Compliant with security best practices

**Search in Railway:** `[AUDIT]`
**Monitor slow queries:** `Slow database query detected`

You're all set! 🚀
