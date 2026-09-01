# EPIC-2 — CALENDAR INTEGRATION

An order's delivery and collection appear in the admin's own calendar, with a reminder, and they
follow the order for the rest of its life: an edit moves them, a confirmed step retires one, a
cancellation removes both.

Read this before touching `ozari-api/src/modules/calendar/`.

---

## 1. What is possible, and what is not

This is the constraint the whole design is shaped around, so it is first.

| Calendar | Can we create/edit/delete events? | How |
|---|---|---|
| **Google Calendar** | **Yes** | OAuth 2.0 + Calendar API v3 |
| **Apple Calendar** | **No — there is no API** | ICS subscription |
| Outlook / anything else | Not built | ICS subscription |

**Apple publishes no calendar write API.** Not a restricted one, not a paid one — none. There is no
OAuth scope for iCloud Calendar, no REST endpoint, and "Sign in with Apple" grants nothing of the
kind. `EventKit` is a native iOS/macOS framework that a web app cannot reach, and iCloud CalDAV
requires the user's Apple ID plus an app-specific password — a credential we must never hold, for a
protocol Apple does not document for third parties. **Do not re-open this looking for a key.**

So there are two mechanisms, and they are not a first and second choice — they are what each
platform actually offers:

- **Google → the API.** We write the events and keep them in step. Real, immediate, revocable.
- **Everything else → a subscribed calendar.** We publish a private ICS URL; the calendar app polls
  it. Apple Calendar, Outlook, Thunderbird and Google itself all accept one.

A subscription is **read-only from the calendar's side**, which sounds like a limitation and mostly
is not: we control the feed, so creating, moving and cancelling all propagate. What it costs is
LATENCY — the client decides when to re-read (Apple: user-configurable, as low as five minutes;
Google: hours, undocumented and slow). That single fact is why Google gets the API and not the feed.

## 2. What is written

One entry per **pending** logistics event, so at most two per order.

- **Summary** — `Entrega · María López`. The kind first, because that is what you scan for when
  three jobs share a day; the client's name second, because that is what identifies the job.
  Deliberately not the order number: an id means nothing at a glance.
- **Window** — the **logistics block**, `[at − gap/2, at + gap/2]` (`calendarWindow` → `padMinutesFor`).
  This is the reuse EPIC-2-DRIVER-AVAILABILITY §6 anticipated: the hour the system refuses to
  double-book is exactly the hour that appears in the calendar, so what the admin sees and what the
  system enforces are one fact, and changing the spacing preference moves both.
- **Location** — the delivery address text, so the entry is tappable-to-navigate in the calendar app.
- **Reminder** — see §3.

**Only what is still to be performed.** `calendarEntriesFor` drops a cancelled order entirely and
any step whose actual is stamped — read off `deliveredAt` / `collectedAt`, never a status id, which
is the same OCCUPANCY rule the logistics pad uses. A confirmed delivery leaves the calendar; a
rewind clears the actual and brings it back, with no code here knowing what a status is.

## 3. ⚠️ The reminder is CLAMPED — this is the point of the feature

A calendar fires a reminder at `start − minutes`. **If that instant has already passed, nothing
fires.** So an order booked 16 hours out with a 24-hour lead would be written into the calendar and
then never announced — the exact failure this integration exists to prevent, and one you would
discover by missing a delivery.

`reminderMinutesFor(start, now, configured)`:

- never more than the time that actually remains, **minus `reminderSafetyMinutes` (5)**;
- never more than Google's own ceiling (40320 minutes — the API rejects more);
- `undefined` once the event has started, because there is nothing left to warn about.

When an order is created inside the lead window the reminder therefore lands a few minutes out. That
is the honest answer: we cannot warn you a day ahead of something happening in sixteen hours, so you
are being told now.

⚠️ **Why the margin exists, and why it is not padding** (owner, 2026-08-31). Clamping to *exactly*
the time remaining puts the trigger on `now` — and the event still has to cross the network to
Google, or be fetched and parsed by a phone, so by the time anything evaluates it the instant has
gone. **Neither vendor documents what happens then**; "fires immediately" and "never fires" are both
plausible readings, and the second is a delivery nobody was warned about. Reserving five minutes
makes the trigger provably future at hand-over, so the outcome no longer depends on a race we do not
control. The margin bites ONLY in the clamped case — with room for the configured lead, that lead is
returned untouched — and inside the margin (an event minutes away) the lead drops to **zero**: a
reminder at the event's own start, still future for as long as the event has not begun.

The **ICS feed recomputes it on every fetch**, against that moment — so a subscribed calendar's
alarms are correct no matter when it last polled.

## 4. Where the settings live

The split is the one Ajustes and Preferencias always draw:

- **Ajustes → Calendarios** (per user): connect/disconnect Google, mint/regenerate/remove the
  subscription URL. A Google account and a device's subscription are *mine*.
- **Preferencias → Operación → Calendario** (business): `calendar.reminderMinutes`. How much warning
  the business wants is *how the business runs*. **ONE value for both transports** — two controls
  would let a phone and a laptop disagree about the same job. Ajustes STATES it and links there.

## 5. The sync

`syncOrderCalendars(orderId)` is the single hook, called after **create**, **update**, **every
lifecycle move** and **delete**.

- **Declarative**, like the order update it follows: it computes what the order should have now and
  makes the calendar match. It never diffs. That is why one call serves every door, why a *missed*
  call self-heals on the next one, and why deleting an order needs no path of its own (the order is
  gone ⇒ nothing is wanted ⇒ both entries are removed).
- **Never throws.** A calendar is a convenience laid over the business, not part of it. Awaited
  (Cloud Run only allocates CPU during a request, so fire-and-forget would be killed), caught,
  logged. A failure against one admin's calendar cannot stop another's.
- **After the commit, never inside the transaction.** Holding a DB transaction open across a call to
  a third party is how a slow external service becomes a lock-contention outage.

### Deterministic ids — why there is no mapping table

Google lets a caller choose an event's id, so `calendarEntryId(orderId, kind)` → `orden12d` is both
the Google event id and the ICS `UID`. Re-syncing addresses the same event; a delete needs nothing
but the order id; "what should be removed" is `allEntryIds(orderId)` minus what we just wrote.

⚠️ The id must match `[a-v0-9]+` and be 5+ characters — **that is Google's rule, not ours**. It is
why the prefix is `orden` (every letter inside a–v) and the kind is a single letter: a `y` from
"delivery" is rejected at insert time, silently, on every order.

### Token handling

`ensureAccessToken` caches the access token (with the expiry skew already applied) and refreshes on
demand. Two rules that bite:

- **Google returns a refresh token only when it mints a NEW grant.** On an ordinary refresh the
  field is absent — writing `undefined` over the stored one disconnects the calendar on its very
  first token refresh. Asserted in `calendar.sync.test.ts`.
- **`invalid_grant` means stop.** The user revoked access in their Google account; that is a
  decision, not a fault. The connection is DEACTIVATED rather than retried on every order for the
  rest of time.

## 6. Security

Two routes are mounted **before the API-key check** (`createApp`), each with its own 20/min limiter:

- **`GET /calendar/google/callback`** — arrives as a top-level browser navigation from Google
  carrying nothing we control (the refresh cookie is scoped to `/api/auth`). The signed `state` JWT
  is its authentication, which is exactly what OAuth's state parameter is for. It also carries a
  `purpose` claim, so an access token signed with the same secret cannot be replayed into it. Every
  outcome is a REDIRECT — the caller is a browser, and a JSON error rendered on the API's domain is
  a dead end.
- **`GET /calendar/feed/:token.ics`** — Apple Calendar sends no header, cookie or origin we control.
  **The 32-byte token in the path is the credential.** Stored as `token_sha` (unique index) plus
  `token_kms` (so the URL can be shown again for a second device — the `email_sha`/`email_kms`
  pattern). Regenerating replaces both, which is the only way to revoke a URL already pasted into
  somebody's phone; the UI says so out loud, right under the button.

Everything else under `/calendar` is **STRICTLY Admin**. When a Driver may connect their own, the
route guard is the ONE thing that widens — the routing rule below already sends each order to its
assignee, so nothing else in the module has to change.

### ⚠️ An order goes to ONE calendar: its ASSIGNEE's (owner, 2026-08-31)

It used to go to **every** connected calendar. That reads like a feature ("the whole team sees the
schedule") and is really a leak: an admin who connected their personal Google account received every
job in the business, including ones assigned to somebody else, in the calendar they run their life
from. The owner found it by having a second admin subscribe and watching a colleague's delivery
appear. A calendar answers *what do I have to do* — an order that is not mine does not belong in it.

Both transports enforce it, from the same field:

- **Google** — `syncOrderCalendars` reconciles EVERY live connection, but only the assignee's gets
  the entries; every other one is reconciled with an **empty set**. That second half is load-bearing:
  it is what removes the events from the previous assignee when a job is reassigned, with no diff, no
  bookkeeping table and no special call site — the sync stays declarative and still self-heals.
  Deleting an event that was never there is a no-op by design, so the extra calls cost a round trip.
- **The ICS feed** — the query is scoped by `assignedUserId: feed.userId`. A feed is one person's
  working schedule.

Two consequences worth stating: an **unassigned** order reaches nobody's calendar (it is not yet
anyone's job), and an order assigned to a **Driver** produces no events until Drivers may connect —
which is now purely the route guard's business.

Disconnecting hard-deletes the row and revokes the grant with Google (best-effort; our copy goes
either way). **Events already written are deliberately LEFT in the calendar** — they are
appointments the person still has to keep, and emptying somebody's week because they unlinked an
integration is a far worse surprise than a few entries that stop updating.

## 7. Setting up Google (what the owner must do)

**The runbook is `DEPLOYMENT.md` §3d** — one-time console configuration, where the two variables live
per environment, the ordered rollout, the smoke test, the publishing/verification checklist and the
troubleshooting table. It is not repeated here; what follows is only the shape of the decision, so
this epic stays readable on its own.

The integration is inert until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` exist. Nothing else is
needed — no SDK, no service account, no billing. The grant is per USER: an admin authorises their own
Google account (any account they control, personal Gmail included), and the backend stores the
refresh token encrypted against that user.

Three decisions are load-bearing, and each is a trap if reversed:

- **Audience = External** (owner decision, 2026-08-31). The app is not owned by a Workspace
  organisation, and an admin connects whatever account they use. `Internal` would restrict the
  feature to a Workspace we do not have. An earlier draft of this section recommended Internal as the
  cheap way around the 7-day expiry — it is not available to us; **publishing is the only route.**
- **Scopes = `calendar.events` + `userinfo.email`, never `calendar`.** The broad scope also grants
  creating, renaming and deleting whole calendars: heavier verification, and a scarier consent screen
  for no capability we use.
- ⚠️ **Testing mode expires refresh tokens in ~7 days.** The sync then stops without an error, and
  every admin has to reconnect. Registering a production redirect URI does not change that — only
  moving the app out of Testing does, which for a sensitive scope means Google's verification review.
  Budget days for it, before the feature is announced.

`API_PUBLIC_URL` is what the redirect URI and the feed URL are built from. It is REQUIRED wherever
something rewrites the Host in front of Cloud Run — which is exactly staging and production, since
the Cloudflare Worker (DEPLOYMENT §3c) hands Cloud Run its own `run.app` name. Left unset there, the
backend would build a redirect nobody registered. Locally nothing fronts the dev server, so it stays
empty and `localhost:3000` agrees by construction.
## 8. What is deliberately NOT built

- **Two-way sync.** Editing an event in Google does not change the order — and the next sync
  overwrites the edit. The order is the record; the calendar is a view of it.
- **Per-driver calendars.** One function away (§6), but the route guard and the connection scoping
  widen together, in their own commit.
- **Push notifications from Google** (`events.watch`). We write; we never read.
- **A per-connection reminder.** One business rule, one value (§4).
