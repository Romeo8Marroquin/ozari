# Ozari — Security incident playbook

**Open this the moment something looks wrong.** It is written to be followed under stress, top to
bottom, by the owner alone — or by the owner telling Claude Code *"I'm under attack: …"*, in which
case Claude reads this file first, names the matching scenario, and walks through it step by step.
Claude cannot read `infrastructure/secrets/`, so every command that touches a credential is run by
the owner; Claude can run read-only `gcloud` checks and read logs.

Commands use `<env>` = `staging` or `prod`, and `<project>` = `ozari-staging-gt` or `ozari-prod-gt`.

---

## 0. The first five minutes

**Golden rules**

1. **Contain first, investigate second.** Cutting off a leaked key costs minutes and is repeatable; a
   leaked key keeps working until it is replaced.
2. **Write down the time** you noticed, and every action with its time. A restore needs a timestamp,
   and an incident note needs the sequence.
3. **Do not delete evidence**: no log purges, no deleting a suspicious user or file "to clean up"
   before it has been looked at.
4. **Smallest action that contains it.** If you KNOW which credential leaked, rotate only that one
   (`rotate.ps1 <env> -Only …`): fewer side effects for clients. If you do not know, rotate everything.
5. **Production first**, then staging — unless the incident is clearly staging-only.

**What are you seeing?**

| You notice | Go to |
|---|---|
| A secrets file, screenshot, chat message, commit or log may have exposed a key; a laptop/phone was lost or stolen | **S1** |
| A user (admin or client) says "I didn't do that", or a sign-in you do not recognise | **S2** |
| Many failed logins, password guessing, "too many attempts" from several people | **S3** |
| Site or API slow/unreachable, traffic spike, Cloudflare shows a flood | **S4** |
| Data missing, changed or wrong; a table emptied | **S5** |
| A deploy you did not make; unknown commits on `dev`/`main`; the API behaves differently | **S6** |
| The website shows something it should not | **S7** |
| DNS changed, unknown Workers/Pages/records in Cloudflare | **S8** |
| Your Google account (the owner of the projects and billing) acted without you | **S9** |
| Emails sent from the domain that nobody sent | **S10** |
| Unknown files in the photo bucket | **S11** |
| An unexpected bill | **S12** |
| Something simply stopped working, no sign of an attacker | **S13** |

---

## 1. Scenarios

### S1 — A credential leaked (or may have)

1. `./infrastructure/scripts/rotate.ps1 prod` (everything) — or `-Only <groups>` when you know
   exactly which key it was (§2 lists the groups). Then the same for `staging` if its file leaked too.
2. **Pushed to GitHub?** Rotate anyway — the value is burnt the moment it was pushed (forks, caches,
   scanners act in minutes). Rewriting history afterwards is optional hygiene, never the fix.
3. **Lost or stolen device?** Treat everything on it as leaked: from a CLEAN machine, sign out all
   sessions + change the password of Google, GitHub, Cloudflare, Neon, Resend and 1Password (each
   has "sign out everywhere"), restore `infrastructure/secrets/` from 1Password, `gcloud auth login`,
   then `rotate.ps1` for **both** environments (the `account` group covers the shared keys once).
4. Finish §2's "right after" list.

### S2 — An app account was taken over

1. **Lock that one person out** (pgAdmin, connected as `neondb_owner` to the environment's database).
   The email is stored encrypted, so the lookup goes through its SHA-256, exactly as the API does:

   ```sql
   SET ROLE ozari_migrator;   -- act as the schema owner (if refused, run the rest without it)
   SELECT id, role_id, is_active FROM users
    WHERE email_sha = encode(sha256(convert_to(lower(trim('persona@ejemplo.com')), 'UTF8')), 'hex');
   UPDATE jwt_sessions SET is_active = false WHERE user_id = <id> AND is_active;  -- signed out, next request
   UPDATE users SET is_active = false WHERE id = <id>;                           -- cannot sign in
   RESET ROLE;
   ```

   Every other user keeps working. To give the account back: `UPDATE users SET is_active = true …`,
   and the person resets their password through the sign-in page's forgot-password link, which sets
   a new password and revokes every session on every device.
2. **If it was an admin**, read what the account did: the app's audit rows
   (`ozari-api/AUDIT_LOGGING_GUIDE.md`) and Cloud Run logs for that user id. Undo through the app.
3. **Several accounts, or you cannot tell which?** `rotate.ps1 <env> -Only sessions` signs EVERYONE
   out at once (no data lost; everyone signs in again).
4. Ask the person to enable MFA (Ajustes) once they are back in.

### S3 — Password guessing / credential stuffing

Already contained by design: the sign-in routes allow 10 attempts/minute per client, and the
per-account counters live in the database (`AUTH-AND-SECURITY.md`). Usually **nothing to do**.

If it is loud or persistent: Cloudflare → `partyrentalsgt.com` → **Security → Events** → find the
source (IP, country, ASN) → **Security → WAF → Custom rules** → *Block* when `http.host` is the API
host and the source matches. The free plan includes custom rules and one rate-limiting rule.

### S4 — Flood / the site is slow or down

- **Money is capped**: Cloud Run never runs more than 2 (staging) / 3 (prod) instances, and the
  Cloudflare Worker's free quota (100k requests/day) simply stops serving when exhausted — it does
  not bill. A flood costs availability, not money.
- **Find it**: Cloudflare → Security → Events and Analytics. Block or rate-limit the source with a
  WAF custom rule on the API host (as in S3).
- **The website itself** (not the API): a custom rule with action **Managed Challenge** scoped to
  the frontend host only. ⚠️ **Never turn on "I'm Under Attack" for the whole zone**: the API is
  called by JavaScript, which cannot solve a challenge, so it takes the app down for everyone.
- **Known gap**: Cloud Run's own `ozari-api-<number>.us-east4.run.app` address is public, so a flood
  aimed at it bypasses Cloudflare. Such requests are refused cheaply (no browser origin, no API key)
  and instances stay capped. Closing it means the Worker sending a secret header the API requires —
  a code change, listed in `ROADMAP.md`.

### S5 — Data deleted or corrupted

**Time matters: Neon can only rewind within the project's restore window, which on the free plan
is hours, not days.** Check it now, not during an incident: Neon console → the project → Settings.

1. If an attacker may still be in: `rotate.ps1 <env> -Only database` (cuts every open session).
2. Note the last moment the data was known good.
3. Neon console → the project → **Backup & Restore** (or *Restore*) → pick that moment. Preview it
   as a **new branch first**, check it in pgAdmin, and only then restore the main branch.
4. After a restore: `./infrastructure/scripts/neon.ps1 <env> -VerifyOnly`. A restore rewinds the
   database's roles too: if passwords were rotated after the restore point, run
   `neon.ps1 <env> -RotateAppPassword -RotateMigratorPassword`, then `tf.ps1 <env> gcp plan` + `apply`.
5. Anything written after the restore point is gone; re-enter it from the audit rows / logs.

### S6 — A deploy you did not make, or malicious code

1. **Stop new deploys**: Google Cloud console → `<project>` → **Cloud Build → Triggers** (region
   us-east4) → the trigger → **Disable**.
2. **Put the last good version back** (it is still there; every build is kept by commit):

   ```powershell
   gcloud run revisions list --service=ozari-api --region=us-east4 --project=<project>
   gcloud run services update-traffic ozari-api --to-revisions=<good-revision>=100 --region=us-east4 --project=<project>
   ```

3. **GitHub**: secure the account (password, 2FA, sessions, Settings → Security log), review the
   unknown commits, revert them, and `rotate.ps1 <env> -Only github`.
4. Once `dev`/`main` are clean: re-enable the trigger, let it deploy, then `tf.ps1 <env> gcp plan` +
   `apply` (Terraform sets traffic back to "latest", which is what you want by then).

### S7 — The website shows something it should not

1. Cloudflare → **Workers & Pages** → `ozari-<env>` → **Deployments** → the last good one →
   **Rollback**. Instant, no build.
2. Find the cause: an unknown commit (→ S6, step 3), or a change in Cloudflare (→ S8).

### S8 — Cloudflare changed behind your back

1. Secure the Cloudflare login (password, 2FA, sign out other sessions; Manage Account → Members:
   remove anyone unknown). Then `rotate.ps1 <env> -Only account`.
2. **See every difference**: `./infrastructure/scripts/tf.ps1 <env> cloudflare plan` — anything it
   wants to change is drift from the declared state; `apply` puts it back. `cf-inventory.ps1 <env>`
   lists objects that are not ours.

### S9 — Your Google account is compromised

It owns both projects and the billing, so it comes first.

1. Recover it (accounts.google.com → Security; Google's account recovery if locked out), change the
   password, review **Your devices** and **Third-party access**, and use a passkey/security key.
2. **Look for strangers** — Terraform only ADDS its own grants, so it does not flag extra members:

   ```powershell
   gcloud projects get-iam-policy ozari-prod-gt --flatten="bindings[].members" --format="table(bindings.role,bindings.members)"
   gcloud projects get-iam-policy ozari-staging-gt --flatten="bindings[].members" --format="table(bindings.role,bindings.members)"
   ```

   Remove anything that is not you, a Google service agent, or an `ozari-*-sa` account.
3. Billing → check the payment profile and recent charges. Then S1 for both environments.

### S10 — Emails nobody sent

`rotate.ps1 <env> -Only email`, then Resend → **Logs** to see what went out and to whom.

### S11 — Unknown files in the photo bucket

`rotate.ps1 <env> -Only r2`. Then, locally, `cd ozari-api; pnpm reconcile:images` (dry run) lists
objects no product references; review, then `-- --fix` removes them.

### S12 — An unexpected bill

Billing → Reports, grouped by service and project, shows what grew. Cloud Run is capped by its
maximum instances; the usual surprises are Artifact Registry (images) and Secret Manager versions,
both kept down by Terraform. Set the budget alert in §4 so the next one is an email, not a surprise.

### S13 — It just stopped, no attacker

| Symptom | Usual cause | Fix |
|---|---|---|
| Pushes to `dev`/`main` no longer deploy | the GitHub token expired (~1 year) | `secret.ps1 <env> github_oauth_token` + gcp plan/apply |
| `tf.ps1 … cloudflare` fails with 401/403 | the Cloudflare token expired (~1 year) | Roll it, `secret.ps1 account cloudflare_api_token` |
| Calendars stop syncing ~7 days after connecting | the OAuth app is still in Testing | `DEPLOYMENT.md` §3d — publish it |
| The first request after a quiet period is slow | Cloud Run and Neon scale to zero | normal (a few seconds) |
| One browser gets 403/503 from the API, Cloud Run logs show nothing, other devices are fine | that browser reuses a stale connection from before an edge change | fully quit and reopen the browser (`REBUILD.md` troubleshooting) |
| `/api/auth/refresh` → 403 "Token CSRF" after a rebuild | a session cookie from the previous environment | expected; sign in again |

---

## 2. Credential rotation — `rotate.ps1`

```powershell
./infrastructure/scripts/rotate.ps1 prod                          # everything rotatable (default)
./infrastructure/scripts/rotate.ps1 prod -Only database,sessions  # only what you KNOW leaked
```

What it does, in order: each dashboard key — **revoke the old one first**, paste the new one at a
hidden prompt; new JWT keys and API key, generated; both database passwords reset and **every open
database session cut** (Postgres keeps a connection alive after a password change, so an attacker
already connected would otherwise stay in); ONE gcp plan + apply that pushes every value **and rolls a
new Cloud Run revision**, so no running instance keeps an old value; finally a check that the live API
answers with the new API key and the new database password. If it stops, it prints what was already
replaced and the exact commands to finish.

| Group | What changes | What a client notices |
|---|---|---|
| `account` | Cloudflare token (Roll) + Neon key — shared by BOTH environments, local only | nothing |
| `email` | Resend key | outgoing emails (password resets, notices) fail for the minutes of the run |
| `r2` | R2 key pair | photo uploads fail for the minutes of the run; existing photos still load |
| `google` | Calendar OAuth client **secret** (the client id stays) | calendar pushes pause; **nobody reconnects** |
| `github` | Cloud Build's GitHub token | nothing (deploys only) |
| `sessions` | both JWT signing keys | **everyone is signed out once**; nothing is lost |
| `api_key` | the server-to-server key | nothing — browsers are recognised by origin, not by this key |
| `database` | both database passwords + every open session | the API errors for ~1–3 minutes, until the new revision is up |

**No data is lost in any group.** Orders, clients and payments live in the database, which is never
touched. The calendar is the one thing worth understanding: the database is the truth and the ICS
feed is computed from it on every request, so the feed is always right. A push to Google Calendar
that fails during the pause is logged, not retried — that order's Google entry catches up the next
time the order is saved or advanced (`EPIC-2-CALENDAR.md` §5: the sync is declarative and
self-heals). A changed client secret is not a revoked grant, so no connection is deactivated.

### Right after the run — what no script can do

- [ ] **Upload the changed files** in `infrastructure/secrets/` to 1Password; the old copies are useless now.
- [ ] **The DBA login** (`neondb_owner`, pgAdmin), if it could be exposed: Neon console → the project →
      Branches → the branch → Roles → `neondb_owner` → Reset password; update pgAdmin. It is stored
      nowhere else, so nothing redeploys. Then `neon.ps1 <env> -VerifyOnly`.
- [ ] **The other environment.** `prod.json` and `staging.json` hold different values by design, so a
      leak of one does not reach the other — unless `account.json` leaked too.
- [ ] **Local `ozari-api/.env`**, if it points at the rotated environment.
- [ ] **The incident note** (§5).

### If the final check fails

| It answers | Meaning | Do |
|---|---|---|
| `401` | the old revision is still serving (it has the old API key) | `tf.ps1 <env> gcp plan` + `apply` again; `gcloud run services describe ozari-api --region us-east4 --project <project>` |
| `503` | the new revision cannot reach the database | `neon.ps1 <env> -VerifyOnly`; if the password is wrong, `neon.ps1 <env> -RotateAppPassword`, then plan + apply |
| `0` / timeout | the edge, not the rotation | `https://ozari-api-<project_number>.us-east4.run.app/api/health/check` directly; then the Worker |

---

## 3. If `encryption_key` leaked

The key alone decrypts nothing; it matters together with a COPY of the database. So:

1. `rotate.ps1 <env> -Only database` — cuts every path into the live data.
2. Could a copy be out (a dump, a pgAdmin export, a branch someone else could reach)? If yes, treat
   it as a breach of client personal data (names, emails, phones): tell the affected clients.
3. Do **not** replace the key. Today the API knows exactly one key, so replacing it makes every
   encrypted column unreadable — both scripts that could do it refuse without
   `-IUnderstandEncryptionKeyLoss`. Rotating it safely is planned work, not an emergency step: the
   API learns to read with a ring of keys and write with the newest, then a background job
   re-encrypts old rows in batches with no downtime, then the old key is dropped (`ROADMAP.md`).

---

## 4. Prepare now — so an incident is short

- [ ] **2-step verification with a passkey or security key** on Google, GitHub, Cloudflare, Neon,
      Resend and 1Password.
- [ ] **Budget alert** at $5/month: Google Cloud console → Billing → Budgets & alerts (an email, free).
- [ ] **Know the Neon restore window** of each project (S5) — it decides how fast you must act.
- [ ] **1Password** holds the current `infrastructure/secrets/` files (re-upload after every change).
- [ ] **Drill**: `rotate.ps1 staging` once, and after any change to the script or the secrets
      registry, and once on production right after it is built (before it has users — the names and
      hosts differ per environment). A runbook nobody has run is a hope.
      **Drills:** staging 2026-10-13 (`-Only sessions,api_key,database`): every role check PASS,
      the open database connection cut, 5 secret versions replaced, revision rolled
      (`secrets-generation` 10 → 14), final health check 200. Production: — *(after it is built)*.

---

## 5. Afterwards — the incident note

A few lines, kept with the project's records: when it was noticed, what happened, what was rotated or
restored (`rotate.ps1` prints the list), what clients noticed, and what changes so it cannot happen
the same way again. If a rule moves into code or a doc because of it, say where.
