# Ozari frontend doctrine (`ozari-app`)

The repo-wide UI rules: error/session lifecycle, motion, forms, stacking, tokens, and the traps that
shipped as real bugs. `CLAUDE.md` carries only the one-line tripwires — **read the relevant section
here before touching panel motion, modals/z-index, entity forms, or the loading/skeleton machinery.**

Most rules below are written as "X, and here is the bug that proved it". The bug is the reason the
rule is not negotiable; deleting the rationale is how the rule gets re-broken.

---

## 1. Global error handling & session lifecycle

The axios interceptor handles failures by **concern, not by status code** (a `401` on a background
refresh and a `401` from a dead session are opposite flows). The five concerns:

1. **Recoverable session hiccup** → silent refresh + retry (`utils/tokenRefresh.ts`). User sees nothing.
2. **Session death** → the *forced-logout choreography* (identical to manual logout, minus the confirm).
3. **Transient feedback** (network / 429 / 500 / 403) → a notification. Nothing else moves.
4. **Contextual failure** (400/401/409 etc.) → handled **inline** at the form level, not globally.
5. **Backend outage (502/503/504) or offline** → the full-screen **app overlay** with a health poll.

Three *distinct* whole-screen failures — don't conflate them: a **render crash** (frontend JS threw →
`ErrorBoundary`, full replace, reload to recover); a **backend outage / offline** (API down or no
internet → `AppOverlay`, a blocking layer *over a still-live app* that auto-recovers by refetching);
and a single **500**, which is neither — one handler's bug while the service is up → toast (or an
inline route-error slot for route data).

### The teardown

- **The bridge** (`utils/sessionLifecycle.ts`) is the non-React mailbox: the interceptor / refresh
  timer call `requestForcedLogout('expired')`; a single React listener
  (`modules/panel/ForcedLogoutListener.tsx`, mounted once in `PanelShell`) runs the real
  choreography. A **single-flight guard** (`inFlight`) collapses a burst of concurrent 401s into
  **one** teardown — re-armed by `resetForcedLogout()` on a fresh login and on a successful refresh.
- **`useSessionTeardown`** (`modules/panel/hooks/`) is the ONE logout choreography, shared by manual
  logout (`LogoutConfirmModal`) and forced 401 logout: `closeAllModals()` → (if forced) `notify` the
  "session expired" warning → `runPanelExit()` → router `navigate('/sesion/inicio')` →
  `clearAuthState()` + `queryClient.clear()`. **Never reintroduce `window.location.replace`** for
  logout — it is a hard reload that kills the smooth exit and wipes the toast (we navigate via the
  router so notifications, which are global, survive). The query cache is cleared AFTER navigating
  (no header placeholder flash).
- **State taxonomy — clear vs keep.** Teardown clears everything **user-scoped** (token, CSRF,
  refresh timer, React Query cache, form drafts, future Zustand stores). It deliberately **keeps
  globals**: notifications, i18n language, the per-device UUID, the maps-app preference. Any new
  client store must declare which side it is on.
- **Refresh failure is split** (`tokenRefresh.ts`): an **auth** failure (401/403 from `/auth/refresh`
  → refresh token rejected) is the ONLY thing that triggers forced logout; a **transient** failure
  (network / 429 / 5xx) keeps the session and just warns. `refreshAccessToken({ silent: true })` is
  for route-guard probes (no choreography, no toast — they redirect themselves).
- **Modal registry** (`components/modalRegistry.ts`): the `Modal` primitive registers its `onClose`
  while open so `closeAllModals()` can sweep every modal (dismissable or not) during teardown.

### Form-owned errors (concern #4) — every new form copies this

Reference: `LoginPage` / `RegisterPage`. A form that shows its own submit errors sets
`skipErrorNotification: true` on its request (so the interceptor stays quiet) and, in the mutation
`onError`, calls `toFormError(error, fallback)` from `utils/apiError.ts` — which routes **inline only
the input-related statuses** the backend actually returns there (login `401` invalid-credentials,
register `409` email-taken / `400` validation), sends **outage statuses (502/503/504) to the
overlay** (returns nothing), and everything else (`429`/`500`/offline) to a **toast**. The inline
banner is `components/FormError.tsx`, above the submit button; it expands/collapses via a
`grid-rows 0fr↔1fr` trick (no layout jump), matching the field-error gentleness (`AnimatedMessage`).

### Error screens & the app overlay

- **`components/ErrorScreen.tsx`** (on-brand, ~0.5s GSAP entrance): `crash`, `maintenance`, `offline`
  variants — deliberately **friendly, not technical** (a white hero card with a static cream→blossom
  gradient band over the top/logo half — the auth `.rotational-asset` essence without the rotation —
  drifting colour blobs behind, plain-language copy, NO "500/503" codes). An `action` slot swaps the
  default reload button for custom controls. They **mount in place** (no navigation /
  `location.href`). Wired to the render-crash `ErrorBoundary` and the router's
  `defaultErrorComponent` (inline, `fill="container"`, keeps chrome, `reset` retries the route).
- **App overlay** (`components/AppOverlay.tsx` + `stores/outageStore.ts`): the **single
  top-of-everything layer** (`--z-app-overlay`, above notifications), mounted once in `__root`.
  Raised by the interceptor on a 502/503/504 (`reportOutage()`), by the browser `offline` event,
  **or** by a network error while online — a dead backend fails as a network error (connection
  refused / DNS / timeout), not a 5xx, so `utils/outageProbe.ts` confirms with a single deduped
  `/health/check` probe before raising the overlay (a one-off blip on a live backend does not
  false-trigger it). The store is a bare `active` flag; the **displayed variant is derived live from
  `navigator.onLine`** — `offline` (wait for the `online` event, then probe) vs `maintenance`
  (backend down, auto-poll) — so an offline→(reconnect, server-still-down) transition switches copy
  with no extra state.
- It fades in, **blocks the whole app** (React Query also pauses its own fetches while offline), polls
  `GET /health/check` every 10s up to 6 auto attempts (bounded so it is not a health-endpoint DDoS),
  then manual-only. **One cooldown timer disables the button for BOTH auto and manual probes** (you
  cannot re-click mid-countdown); the manual guard is a JS timestamp, not just the `disabled`
  attribute (survives DOM tampering; the backend rate limit is the real guard). A failed probe shows a
  smooth, per-reason "still failing" note (`CollapsingNote`, same `grid-rows` motion as `FormError`).
  On a healthy probe it **fades out and `invalidateQueries()`** (soft refetch — NO reload).
  Outage/offline never toast (the overlay owns them). It is a proper blocking dialog: **scroll-lock +
  focus-trap + focus-restore** (like `Modal`), `role="alertdialog"` with an `aria-label`, and it
  **remounts its content per activation** (a `session` key) so a re-outage never inherits stale poller
  state. The overlay is **global** state — teardown must not clear it.
- **i18n:** error copy lives under `errors.*` (incl. `sessionExpired`, `maintenance`, `offline`,
  `tooManyRequestsWait`) and `errorScreen.*` (incl.
  `maintenance.retryIn`/`autoRetrying`/`autoStopped`). Preview the card designs in dev at
  `/#preview-crash` / `/#preview-maintenance` (full load).

---

## 2. Brand surfaces: the canvas, the loader, the isotype

- **Brand isotype:** `components/LogoMark.tsx` is the shared, text-less hexagon+arch mark (inline SVG,
  `currentColor`, thicker stroke, tightened viewBox) — used by the panel (`BrandMark`), the auth
  cards, and the error screens. **Never crop the wordmark `logo.svg`** for an icon (it clips the tip).
- **The app CANVAS is `.app-canvas` (`index.css`) — one full-screen surface, and it is near-NEUTRAL**
  (2026-08-04). Worn by the auth screens (`SesionLayout`) and the route loader (`PageLoader`); the
  brand colour appears only as small contained accents (a card's gradient band, a spinner arc, a focus
  ring). `PageLoader` used to be a full-bleed `cream→blossom`, which on a phone filled the viewport
  with saturated yellow-to-pink: it read as a splash screen from a different product, and it made
  every hand-off — to the near-white panel, to a white auth card — a visible colour pop. **A saturated
  wash is never the answer for a whole viewport here.** `--canvas-edge` is the gradient's end tone,
  which `SesionLayout` also paints onto the document canvas so an over-scrolled strip (mobile
  keyboards shrink only the visual viewport) matches — change one, change both.
- **`PageLoader` is built from the app's OWN brand object, and that is the rule** (two rejected
  attempts): the colour lives in a **contained shape on a neutral canvas**, and the shape is a
  **rounded SQUARE**, because `BrandMark` (the sidebar tile — a `rounded-xl` cream→blossom square
  holding the charcoal `LogoMark` at 88%) is the only brand container the product has. A white
  **circle** with the logo inside — the first redesign — exists nowhere else and read as foreign; a
  neutral canvas *plus* a neutral object read as "barely ours". So the loader is that tile at hero
  scale (deliberately MIRRORED, not imported: `BrandMark` is fixed at `size-11` and overriding a
  Tailwind size utility from a `className` prop is decided by stylesheet order, not the class list),
  with a blurred cream→blossom **halo wider than the outline** (contained, so the colour reads as a
  fill and the screen still looks white) and its own outline as the indicator: a hairline track plus
  one gradient beam orbiting it. **The orbit gap is load-bearing** — tight against the tile the beam
  reads as an app-store download badge; the two radii are kept concentric (outer = tile radius + gap).
  Loading state is announced via an `sr-only` `role="status"`, never drawn: text that flashes in and
  out on a fast route is noise. Preview it at **`/#preview-loader`** (DEV-only, beside
  `#preview-crash`/`#preview-maintenance` in `main.tsx`) — the router otherwise only shows it after a
  route has been pending a full second.
- **A router `pendingComponent` cannot own a GSAP exit** — React unmounts it the frame the route
  commits. `PageLoader`'s exit is the router's view transition, SHAPED by naming its mark
  (`.page-loader-mark` → `::view-transition-old(page-loader)`, `index.css`): that lifts the mark out
  of the root snapshot so it gets its own dissolve curve while the root cross-fade handles a
  background that is now identical on both sides, i.e. invisible. There is no `-new(page-loader)`.
  The router's own `pendingMs`/`pendingMinMs` defaults (1000/500) already handle anti-flash — do not
  add a second delay.
- ⚠️ **Two SVG dash traps, both hit by the loader's beam and both silent:** (1) `pathLength` does NOT
  reliably rescale `stroke-dasharray`, so a literal `26 74` on a 331-unit path became 3.3 repeats
  instead of one beam — derive the dash from the path's REAL perimeter (`OUTLINE_LENGTH`, a constant:
  the path lives in viewBox units, so it does not change with the breakpoint) and keep
  `dash + gap === perimeter`, which guarantees exactly one dash AND a period that lets one
  full-length offset tween loop seamlessly. (2) **`vector-effect="non-scaling-stroke"` moves
  stroke-dasharray into post-transform space too** — the pattern is then measured against the
  RENDERED length, so it repeats once per unit of scale (two beams at `md`, a different count per
  breakpoint). Never combine it with a dash pattern; let the stroke scale with the object instead.

---

## 3. Auth page animation (login ↔ register)

- **Single transform owner.** The card's gradient panel (`.rotational-asset`) is driven **only** by
  GSAP (`xPercent`/`yPercent`/`rotation`, `transformOrigin: center`). Do **not** put Tailwind
  `rotate-*`/`translate-*` utilities on it — Tailwind v4 emits those as the independent
  `rotate:`/`translate:` CSS properties, which fight GSAP's `transform` matrix (the old "rotates but
  does not translate / white corners" bug). Keep only static visual classes (gradient bg, blur) +
  `inset-0 m-auto` centering on an oversized panel.
- **`useAuthCard(variant)`** (`modules/sesion/hooks/useAuthCard.ts`) is the single owner: it holds the
  `container`/`gradient` refs, the `COVER`/`settled` keyframe states, the enter timeline,
  `leaveTo(path)`, `redirectAfterSuccess(path)`, `swapFormColumn(commit)` and the resize handler.
  Both pages are thin consumers — do not reintroduce per-page GSAP duplication.
- **The `COVER` seam.** Every leave ends at fully-covered (rotation 0, centered); every enter starts
  at `COVER`. That shared boundary makes the login↔register sweep continuous ("cover the whole card,
  then settle"). `SesionLayout` persists across the switch (only the `<Outlet>` swaps) and its
  mount-fade fires **only on fresh load/reload** — that is the "quick fade on reload, not on switch"
  distinction; no extra flag is needed.
- **Resize = snap.** On a mobile↔desktop breakpoint cross the hook `killTweensOf` + `gsap.set`s the
  gradient to the new layout's settled state (no tween). Animations are reserved for intentional
  login↔register switches.
- The shared auth **background** lives on `SesionLayout` (covers all `/sesion/*` pages). Gradient
  rotation/offset magnitudes in `useAuthCard` are visual constants — tune them there, in one place.
- `leaveTo`/`redirectAfterSuccess` are **idempotent** (a `departing` ref ignores re-fires once a
  departure timeline is in flight). Don't remove that guard.

---

## 4. Panel page transitions — the interruptible motion doctrine

`PanelLayout` owns a transition **controller** for tab changes: ONE in-flight transition at a time,
**latest intent wins**, and nothing ever blocks, queues, or restarts.

- Idle click → the page's exit plays (content + header title in lock-step), THEN the route commits and
  the incoming page plays its own entrance. Mid-exit click on a **different** target → only the run's
  destination swaps (the running exit continues untouched). Mid-exit re-click of the tab being
  **left** → **cancel**: the exit is cut at the current frame and the content settles back in
  (`enter({ fromCurrent: true })`), no navigation. Click during an **entrance** → a fresh exit cuts it
  at the current frame. All "cutting" is GSAP `overwrite: true` — creating a tween kills the tweens
  already driving the same targets, so motion always continues from the current frame.
- The run object is a **token**: cancel/logout detach it, so a stale exit's completion handler no-ops
  instead of navigating (`navigateBody` in `PanelLayout.tsx`). Logout (`runExit`) abandons any
  in-flight tab run first.
- `PanelNavContext` provides `{ navigateTo, pending }`. The sidebar's active pill and tint are
  **derived** from `pending ?? route` — they glide to the intent the moment a click lands and glide
  home for free on cancel. `NavItem` forwards EVERY plain click to the controller (never swallows the
  active tab — that click is how a user cancels).
- **The chrome animates by SECTION, never by path**: `panelSectionFor` in `navConfig.ts` resolves any
  panel path to its nav tab (`/panel/productos/7/editar` → `/panel/productos`), and BOTH the header
  title (`PanelLayout` — titleOut only on section change; a mid-exit retarget to another section fires
  it late) and the sidebar pill/tint (`Sidebar` — `visualTarget`/`leavingKey` compare pending's
  SECTION) animate only when the section changes. Same-section moves (grid → detail → edit) keep the
  title and the tab perfectly still — the old raw-path comparison hid the pill (no nav item matches a
  detail path) and re-animated the same title, which read as a glitch.
- Pages register `{ enter, exit }` via `usePanelPageMotion` and play their own entrance on mount (a
  plain layout effect, NOT `useGSAP` — no context-revert surprises); the layout calls the registered
  `enter` only to resume after a cancelled exit.
- **The exit doubles as a preload window**: `navigateBody` fires `router.preloadRoute({ to })`
  (best-effort, error-swallowed) when a run starts AND on every retarget, so a code-split chunk
  downloads while the exit plays and the commit never flashes the router's pending loader.
- **Division rule:** GSAP owns choreography (transform/opacity sequences); CSS transitions are for
  binary UI state (sidebar pill/drawer/collapse rail, the Modal shell, FormError) because CSS
  transitions retarget natively — never both on the same property of the same element. Panel
  navigations pass `viewTransition: false` (essential — the browser cross-fade fights GSAP); auth
  navigations deliberately do NOT (shipped behavior, don't "fix" it).

### The shared vocabulary (`modules/panel/pageMotion.ts`, coverage-excluded)

`staggerIn`/`staggerOut` (pages), `staggerInNested` (blocks + their own inner wave — see the
preferences screen), `fadeIn`/`fadeOut` (default whole-screen), `headerTitleIn/Out`. Hard rules:
**never `gsap.from`** (a `.from` restoring visibility caused the old one-frame flash of the outgoing
page); every tween sets `overwrite: true`; Promise helpers resolve on `onComplete` AND `onInterrupt`;
an exit's final `autoAlpha: 0` persists untouched until React unmounts the page.

- **Stagger = a responsive row/column WAVE, not a DOM-order line** (`waveDelays`). Items inside a CSS
  grid get a 2D position — the row dominates the delay, the column adds a smaller ripple
  (`COLUMN_RIPPLE = 0.35` of a row step) — so a grid cascades diagonally from the top-left; non-grid
  items (a header row, stacked sections) each take their own row in DOM order. Column count is read
  from the RENDERED grid (`getComputedStyle(...).gridTemplateColumns`) at animation time, so it adapts
  to the breakpoint (2 cols on phones → 6 on ultrawide) and is re-derived on every enter/exit. Delays
  are normalized to a fixed BUDGET, so the total spread is constant regardless of item count (many
  items per row ⇒ each intra-row step shrinks toward imperceptible — by design). Exits use the same
  wave direction on the tighter exit budget.
- **A LATERAL move never scales** (`SCALE_FOR`). Scale is a *depth* cue whose visible size is
  proportional to the element: the vertical default's `0.98` is 1.6px of edge travel on an 80px agenda
  row (imperceptible) but ~6px on a 320px section card — and with the default center origin that reads
  as the card starting LOWER and rising as it settles, which is exactly the "it still goes a little
  down" in an otherwise side-to-side transition (the preferences groups). So `from`/`to` a SIDE ⇒ pure
  slide + fade, in `staggerIn`, `staggerOut` and `staggerInNested` alike; only `bottom`/`top` keep the
  scale.
- **Adding something is a request to SEE it.** `revealInScroller` scrolls the MINIMUM needed to bring
  a just-appeared element into view — never past its own top, so a tall form never loses its first
  field — on the entrance curve, so the growth and the follow are one movement. It resolves the
  NEAREST scrolling ancestor, so the same call works on a panel page and inside a dialog. Wired to
  every "add a row" affordance: the preferences editor, the product form's details, the order form's
  lines, the client-registry modal's contacts/addresses. Removal deliberately does NOT scroll — the
  height eases shut and the browser's clamp rides down with it, so a second motion would compete. It
  is the one part of `pageMotion` with its own tests (`pageMotion.test.ts`): the module is
  coverage-excluded as visual-only, but this function makes a DECISION whose failures are silent.
- **Motion tokens** live in `@utils/motion`: `PAGE_EXIT` (0.2s, power2.in) / `PAGE_ENTER` (0.45s,
  power3.out) — asymmetric on purpose (fast out, slower settling in) — plus the stagger budgets
  (`PAGE_EXIT_STAGGER` 0.12 / `PAGE_ENTER_STAGGER` 0.35) the wave distributes. `prefersReducedMotion`
  is imported from there everywhere (no local copies).

### ⚠️ FLIP snapshots go stale when the PANEL scrolls

`Flip.getState` records viewport rects and GSAP compensates only for the **document's** scroll
(`_getDocScrollTop`) — but every panel page scrolls inside `main.panel-main`, which GSAP cannot see.
So any snapshot held ACROSS a scroll describes boxes that have all moved by the scroll delta, and the
next `Flip.from` glides the whole list by that amount before settling. `useMorphOnChange` was exposed
(it snapshots after every commit and holds it until the next key change, which can be many scrolls
later) and now re-snapshots on the panel's `scroll`, coalesced to a frame. `useGridListTransition` is
NOT exposed — it captures immediately before its own state change and consumes it in the very next
commit. **Any new FLIP must capture just-in-time or re-capture on scroll**; the symptom is subtle (a
whole list "does a little animation", worse the further you had scrolled, and it stops after one
interaction because that interaction re-snapshots).

### ⚠️ Animated heights fight the browser's scroll anchoring

A tween that changes an element's height every frame is exactly the input scroll anchoring reacts to:
it re-scrolls to keep some node visually fixed mid-tween, which reads as the view jumping under the
animation — and it self-suppresses after a few adjustments, so it looks intermittent.
`[overflow-anchor:none]` therefore lives on the panel's `main.panel-main` AND on the `Modal` body,
once each, not per page: GSAP owns choreography here, and that includes the scroll.

### Scroll memory, grid diffs, the panel exit

- **Per-page scroll memory is automatic** (`PanelScrollMemory`, mounted in `PanelLayout` BEFORE the
  scroller so its restore runs before any page's own layout effects): every panel path remembers its
  scroll and restores it on return; unvisited paths open at the top. New pages need nothing. A page
  that must ALWAYS open at top (the product detail — its image-morph landing rect depends on it) calls
  `scrollPanelToTop()` in a pre-paint layout effect and simply wins. Positions clear on panel unmount
  (logout).
- A background-refetch list change on the WARM product grid animates as a two-phase diff
  (`useGridListTransition` + `animateTilesOut`/`animateListReflow` — leaving cards shrink out,
  survivors FLIP-glide by `data-flip-id`, new cards rise in); cold/filter/append flows keep their own
  skeleton machinery.
- The grid's skeleton→card resolution rides the SAME row/column wave as page entrances: every slot's
  `SkeletonFade` flips in one React commit, so each cell derives its own delay from the rendered grid
  via `revealDelaySeconds={gridCellRevealDelay}` — without it the whole grid's content crossfades at
  once (the "wall of info" fix). **Any new grid of `SkeletonFade` slots must pass it.**
- The panel **exit** (`PanelLayout` `runExit`, exposed via `PanelExitContext`) is the mirror of its
  GSAP entrance, played on logout before navigating to login (which then runs its own mount-in) — so
  sign-out is a smooth exit→enter hand-off, not an abrupt redirect. Keep the two in sync.
- The header pill's name comes from **`useMe`** (`GET /auth/me`, cached under `QueryKeys.ME`) — the
  access token carries no PII, only `userId`/`userRole`, so the **role** is labelled instantly from
  the decoded token while the name loads. Avatar initials follow the Guatemalan naming convention in
  `utils/nameFormat.ts` (`getInitials`). While `/auth/me` is in flight the pill/menu render a
  **skeleton** (`animate-pulse`), never a placeholder name.

---

## 5. Entity forms doctrine (create/edit)

- **Create/edit = a dedicated PAGE through the panel transition, never a modal** (owner decision,
  2026-07 — see EPIC-1-INVENTORY §3.5 for the reusable decision tool). Modals stay for confirmations,
  step-up security, and quick single-field actions. Reference implementation:
  `/panel/productos/nuevo` → `modules/panel/products/ProductCreatePage.tsx` + `ProductForm.tsx`.
- A nested panel page joins the animated navigation by **extending the `PanelPath` union**
  (`navConfig.ts`) WITHOUT joining `PANEL_NAV` — the sidebar's `startsWith` matching keeps the parent
  tab lit. Its route file needs the **underscore escape** (`productos_.nuevo.tsx`) because the list
  page renders no `<Outlet>`.
- **Form recipe** = the `ChangePasswordModal` doctrine on a page: RHF + mirrored Zod
  (`SchemaCreateProduct.ts` mirrors the backend validator; shared limits in `constants/Regex.ts`),
  `skipErrorNotification` mutation, backend validation → the `FormError` banner via `toFormError`,
  ambient → toast, outage → silent. Selects/textarea use the `CustomSelect(Form)` /
  `CustomTextarea(Form)` primitives (styled native elements, same floating-label language as
  `CustomInput`).
- **RHF gotchas:** `setValue`/`reset` IGNORE `undefined` (they fall back to defaults), so the
  empty-selection sentinel is **`null`** end-to-end (selects map `'' ↔ null`); use `useWatch`, not
  `watch()` (the React Compiler lint rejects `watch`).

### Unsaved work = silent draft, never `beforeunload`

Autosave to sessionStorage on change (`productDraft.ts` / `orderDraft.ts` + a `useWatch` effect),
restore on return with a visible note + explicit discard, clear on success — and on logout
(`clearAuthState` removes both; drafts are user-scoped). **CREATE only**: an edit's server state is
authoritative, and a stale edit draft would silently resurrect values somebody else may have changed.

- **ONE SWITCH PER FORM**, not a global (owner decision 2026-08-26): `forms.saveDraftOrders` /
  `forms.saveDraftProducts` (Preferencias → Operación → Formularios, both ON by default). The two
  forms are used by different people at different moments — an order is filled with a client on the
  phone, a product is set up once at a desk — so the answer for one is not the answer for the other.
  A new form adds a key to the API registry and a member to `DraftForm`.
- These are the first `bool` settings, which is why `SettingDefinition` / `PreferenceSettingModel` /
  `PreferenceSetting` grew a third arm and `PreferenceSettingsCard` renders a `Switch`. The API
  accepts a REAL boolean only: `"true"` and `1` are rejected rather than coerced, because this
  endpoint is declarative and admin-only, so a wrong-shaped body is a stale client and coercion would
  apply a setting nobody chose. `useFormDraftsEnabled(form)` reads it and **defaults to ON while the
  query is in flight** — defaulting to OFF would make a refresh discard the very draft it was about to
  restore. Off ⇒ the form does not read a stored draft AND actively empties the slot: switching the
  feature off means "nothing of mine is kept", not "nothing new will be".
- **The note is ONE component** (`panel/FormDraftNote.tsx`) with one i18n block
  (`modules.panel.formDraft.*`). Each form had grown its own wording, which is the same drift the
  shared document template exists to prevent: two screens describing the same mechanism in different
  words teach the admin that they are different mechanisms.
- ⚠️ **The draft is SEEDED into `defaultValues`, never `reset()` in after mount.** Seeding means no
  watcher observes a CHANGE, so none of the prefill effects fire. A `reset()` looks identical and then
  lets the order form's client-selection effect overwrite the restored contact, address, pin,
  instructions and delivery fee with the client's CURRENT defaults — silently rewriting the admin's
  own work. For the same reason `previousRegistryId` is seeded from the draft as well as the order.
- The note is measured against **pristine** defaults, not the seeded ones: comparing a restored draft
  against itself reads as "untouched" and deletes it.
- Any suite that mounts a create form must `sessionStorage.clear()` in `beforeEach`, or every test
  after the first inherits the previous one's half-typed form.
- The transient-appearance pattern for in-form notes is the always-mounted `grid-rows 0fr↔1fr`
  collapse (never conditional render — it pops and shoves).

### The loading doctrine (per-card skeleton reveal)

Reference data comes from `GET /products/catalog` (`useProductCatalog`, `staleTime: Infinity`) with a
**per-card skeleton reveal** while loading and a retry panel on failure. Each section card keeps its
REAL chrome (title/description) and only its body shimmers (`SectionReveal` +
`pageMotion.revealSectionContent`); on load the cards reveal in a cascade (`SECTION_REVEAL_STEP`),
each card morphing its height to the content while its `.reveal-item` fields wave in — an integrated
per-card transformation, never a whole-column swap.

**The staggered reveal the eye reads as "smooth" is this per-card `SectionReveal` morph on DATA
LOAD**, NOT the page's mount `staggerIn` on the `.reveal-block` cards (a constant-budget cascade that
tightens as sections multiply) — a form that never reaches a usable data state shows only the tighter
entrance, so the fix is getting it to `dataReady`, not more animation.

### ⚠️ Data-dependency states are THREE, not one

Never blanket-"retry" a form that depends on seeded reference/preference data. Both `ProductForm` and
`OrderForm` split into:

1. a **request error** (a fetch actually failed → the `ProductsStatus` `tone="error"` RETRY panel; the
   interceptor already toasted the ambient notice);
2. a **config** state (every request SUCCEEDED but a required seeded lookup is empty — event/contact
   types for orders, category/currency/etc. for products → `tone="config"` routing to the real
   preferences screen `/panel/preferencias` via the shared `modules/panel/PreferencesCta.tsx`, so the
   admin lands exactly where the missing lookup is created);
3. (orders only) an **empty-products** nudge (`tone="empty"` → create a product).

An empty CLIENT-REGISTRY list is explicitly NOT a blocker (create one inline). The swap between these
views rides `useViewSwap`/`useOrderViewSwap` (`staggerOut → swap → staggerIn` on `.reveal-block`),
never a hard replace. i18n: `configMissing.*` per form + shared
`modules.panel.dataStatus.goToPreferences`.

---

## 6. A row of derived actions ADAPTS — `ActionRow` (owner rule, 2026-08-30)

`modules/panel/ActionRow.tsx` is the one behaviour behind the quick actions on the **agenda ticket**,
the **dashboard's up-next card** and the **order detail's state card**. Those buttons are derived from
the order's state — the advance step comes from the lifecycle engine, "Abrir en mapas" appears only
while the next move is a trip, "Registrar pago" flips to "Deshacer pago" the moment money is recorded
— so one tap can remove a button, add another and re-align the rest. React does all of that in ONE
frame: the middle button vanishes and its neighbour teleports into the gap.

- **The sequence is LEAVE, then REFLOW — never both at once.** They are different statements ("this
  action is gone" / "the row is now shorter"), and running them together is a mush the eye can follow
  neither half of. Phase 1: departing buttons keep their space and fade where they stand
  (`animateTilesOut`, the gallery's removal language). Phase 2: the boxes are captured, the new set
  commits, and survivors GLIDE into the vacated space while arrivals rise in (`animateListReflow`).
  Same two-phase shape as the products grid diff, and the same stance as the deletion rule below.
- **The key is what an action IS, not where it sits.** `advance` keeps its key while its label morphs
  from "Marcar En ruta" to "Marcar Entregado", so the button adapts in place (`MorphSwap` inside it);
  `pay` genuinely leaves when it becomes `undo-pay`. A key encoding position would animate every
  neighbour as a replacement.
- **A SURVIVOR always renders the caller's newest node**; only what is on its way out falls back to
  the copy the row committed. Otherwise a label would be a frame — really 0.25s — behind the status
  chip beside it, and the two would visibly disagree.
- Two React-Compiler-lint constraints shaped the implementation, and both are the repo's own patterns:
  the committed list is **state, not a ref** (a ref read during render is a lint error *and* a real
  staleness hazard), and it is refreshed by **adjusting state during render**
  (`OrderPaymentModal`'s pattern) rather than `setState` in an effect. The commit always rides the
  promise — `animateTilesOut([])` is already resolved, so a pure addition still lands in the same
  frame.
- The order detail's `useMorphOnChange` key had to grow `isPaid`: keyed on the status alone, taking a
  payment re-wrapped the button row and resized the card in one frame. Its `.state-flip` ITEM (the
  state sentence) still moves only with the status — that is what `itemsKey` is for.

---

## 7. Deletion: confirm FIRST, animate second, then re-read (owner rule, 2026-07-30)

A row must never leave the screen before the server agreed it should. The order is: fire the request →
the dialog holds with its spinner (`locked`) → on the answer, play the exit → only then edit the cache
→ then invalidate so the screen re-reads itself. Animating first and undoing on failure is a guess
dressed up as a result: it shows the row gone while the request can still fail, and it forces the
client to PREDICT which door a conditional delete will take just to know whether to animate at all.

- The preferences catalogs are the reference implementation: `useCatalogRowMutations`'s delete
  mutation only REPORTS, and a separate `commitDeletion(id, outcome)` edits the list — because the row
  cannot animate once it has been removed from it. That split is what makes "confirm first"
  expressible.
- The exit uses `editorSlotOut` (opacity only), NOT `detailRowOut`: inside a `useMorphOnChange` region
  the region owns the height, so the row fades where it stands and the region eases the gap shut in
  one continuous tween. Collapsing the row too would close the same space twice.
- **Re-read after every write**, not just after a delete: this admin is not necessarily the only one,
  and a screen that only ever patches its own writes never discovers a neighbour's. An identical
  answer is visually silent (same rows ⇒ the morph key is unchanged ⇒ nothing animates).
- `useDeleteOrder` / `useDeleteProduct` already follow this shape (navigate away on success, lists
  invalidated). Removals from a FORM (product details, order lines, registry contacts, staged photos)
  are local state with no endpoint — there is no confirmation to wait for, so immediate is correct
  there.

---

## 8. Anything with fields is a `<form>` — that is what makes Enter submit

A styled `<div>` with inputs and an `onClick` button LOOKS like a form and behaves like one until
someone presses Enter, which does nothing (the preferences editors shipped that way). Implicit
submission needs a real `<form onSubmit>` **and** a `type="submit"` button — `Button` defaults to
`type="button"`, so Cancel and other actions stay inert automatically and only the primary needs the
prop. When the submit button lives in a `Modal` footer (outside the form element), associate it with
`<Button type="submit" form={FORM_ID}>` — the pattern `ChangePasswordModal` / `MfaDisableModal` /
`ClientRegistryModal` already use.

**A form whose inputs carry `min`/`max`/`required` needs `noValidate`.** Otherwise the browser blocks
submission with its own untranslated bubble, our mirrored message never renders, and Enter reads as
"nothing happened" — the exact failure the form element was added to fix. The app owns its validation
language; native constraint UI is a different, unstyled one. (`ProductForm` and `OrderForm` set
`min`/`max` on number inputs without `noValidate` — pre-existing, so an out-of-range value there still
surfaces the native bubble instead of the inline error. Worth aligning when either is next touched.)

Multiline fields are the exception: Enter inserts a newline in a `<textarea>`, so a reason/notes field
is submitted by its button (`OrderAdvanceModal`). A search box commits on Enter via its own
`onKeyDown` (`ProductsFilterBar`), because it filters rather than submits.

---

## 9. Auto-focus is a DEVICE decision (owner rule, 2026-07-29)

`isFinePointerDevice()` (`@utils/pointer`) is the single source: focus a field on mount **only** on
hover + fine-pointer devices. On touch it throws the on-screen keyboard over half the screen the
instant a dialog or step appears — unasked, usually over the text explaining the decision — and it
breaks entrance animations (notably Android). React callers use `useDesktopAutoFocus` (the same rule,
evaluated once on mount).

- **Dialogs get it for free.** `Modal` applies the rule itself: a fine pointer lands on
  `[data-modal-autofocus]` (else the first focusable), touch lands on the **panel** — which is why it
  carries `tabIndex={-1}`. Focus always enters the dialog (the trap, Escape and the screen-reader
  announcement all depend on it); only the LANDING SPOT changes. Never "the first focusable" on touch:
  that is usually the same input.
- **`MfaCodeField` treats its `autoFocus` prop as an INTENT the device may veto**, so it is correct
  both inside a dialog and on the login card. A new field that wants mount focus should do the same
  rather than hard-code `autoFocus`.
- The whole test suite runs as TOUCH (the global `matchMedia` matches only reduced-motion), so a
  desktop-path test must stub `matchMedia` — see `Modal.test.tsx`'s `asDesktop()`.

---

## 10. Responsive rules

### A wrapped `justify-between` row leaves its last item at the LEFT

A flex container distributes each LINE independently, so when a header row wraps, the line holding a
single item gets `flex-start` — a primary action that was right-aligned on desktop lands hard left on
a phone, reading as neither aligned nor centred (the orders header). Two fixes, used together: give
the control group `w-full … sm:w-auto` so it owns the wrapped line (start ↔ end becomes a real
space-between), and put `ml-auto` on the action so it stays right even when it drops to a line of its
own. Both are inert once the group is content-width at `sm`, so the desktop layout is untouched.

### A floating label leaves its own box — stacked fields need `gap-field`

`CustomInput`/`CustomSelect`/`CustomTextarea` position the label absolutely and translate it **24px
up** when the field is filled or focused, so a floated label paints **~13px ABOVE the input's top
edge**, in space the field neither reserves nor can see. Nothing looks wrong until the element above
ends with text at its own bottom edge — a field's `AnimatedMessage` help line or its error — and then
the two print on top of each other. It is worst where it is least likely to be caught: a two-line
message on a phone, or a `grid` that stacks into one column below `sm`.

`--spacing-field` (16px, `index.css`) is that clearance with a name: **`gap-field` on a column of
fields, `gap-y-field` + a smaller `gap-x-*` on a grid** — the columns need no such room and widening
them would open holes in the layout (owner constraint). Fixed at: the client-registry modal's address
column and its contacts grid, and the order form's line grid. It is NOT a general form rhythm: a field
followed by a button, a radio or a note needs nothing, because what overflows is the LOWER element's
label.

### Responsive truncation rule (`min-w-0`)

A `truncate` only works if EVERY flex/grid ancestor between it and the page column can shrink — flex
items and **grid items default to `min-width: auto`**, so one long unbreakable value (a full name, an
email) silently propagates its untruncated width upward and pushes the whole page wider than a phone
viewport (the panel `main` is `overflow-y-auto`, which computes `overflow-x` to auto, so it clips
instead of scrolling the document — the page just looks cropped). This bit Settings at mobile widths;
the fix is `min-w-0` on each flex/grid ITEM in the chain (see `SettingsSection.tsx`). When adding any
row that renders user-controlled text, verify at ~320px with a long name AND a long email; the audit
trick is measuring `el.getBoundingClientRect().right > document.documentElement.clientWidth` over all
elements.

### ⚠️ A stretched `<svg>` needs `w-full`, and `min-w-0` is NOT a substitute

(The dashboard scrolled sideways on every phone.) An `<svg>` carrying a `viewBox` is a REPLACED
element with an intrinsic ratio: give it a definite height and an `auto` width and its min-content
contribution becomes the *transferred* size (`BarChart`: 128px × 320/120 = **341px**), which every
ancestor must then be wide enough to hold. `min-width: 0` is a FLOOR and never lowers a contribution,
so `min-w-0 flex-1` looked exactly like the fix and was not one — the chart's card grew to 429px
inside a 288px column, `main.panel-main` computes `overflow-x` to auto, and the whole screen gained a
horizontal scroll whose cause was nowhere near where it looked. A percentage width resolves the
contribution against the container instead. The same trap waits for any future full-width chart; the
dashboard's chart cards additionally carry `min-w-0` as grid items, per the rule above.

---

## 11. Stacking order (z-index doctrine) & modals

The **single source of truth** for z-index is the `--z-*` custom-property scale in `src/index.css`
(`:root`). Never write a bare `z-40`/`z-50` — reference the token: `z-[var(--z-float-header)]`. Two
bands, read back-to-front:

1. **Structure** (normal flow): content (base) < `--z-header` (20) < `--z-sidebar` (30).
2. **Floating** (popped out of flow), ranked by which chrome the float belongs to: `--z-float-body`
   (100) < `--z-float-header` (200) < `--z-float-sidebar` (300). So a body float sits over the
   structural chrome; the **header** user-menu float sits over body floats; the **sidebar**
   mobile-drawer float sits over the header menu — opening the pill menu and then the hamburger
   correctly paints the drawer OVER the menu.
3. **App overlays**: `--z-modal` (1000) < `--z-notification` (2000) < `--z-app-overlay` (topmost).

**Floating elements must be portaled to `<body>`** so they escape their origin's stacking context —
only then does the scale actually decide who wins (a menu nested inside the header's own `z-header`
context cannot rise above the sidebar). The header `UserMenu`
(`modules/panel/components/UserMenu.tsx`) is the reference implementation: a `createPortal` dropdown
at `--z-float-header`, positioned under the pill and re-anchored on scroll/resize, with full menu a11y
(roles, arrow/Home/End/Escape nav, click-outside, focus return, `inert` when closed).

### The `Modal` primitive

`components/Modal.tsx` is the reusable modal at `--z-modal` (centered dialog over the drawer-style
scrim). It does focus-trap + restore, scroll-lock, and `role="dialog"|"alertdialog"`.

- **A modal owns its own EXIT: keep it mounted and flip `open` to false.** Rendering
  `{isOpen && <Modal open …/>}` removes the dialog in the same frame and the close animation has
  nothing left to play, so it blinks out (the location picker shipped that way); the fix is an
  `everOpened` latch, which also preserves lazy-loading a heavy body.
- Dismissal is a single **all-or-nothing** `dismissible` prop — when true the ✕, backdrop-click and
  Escape are ALL on; when false NONE are (the modal is then resolved only by its own actions) — plus a
  `locked` flag that suspends dismissal during in-flight async work.
- Its `.modal-stagger` sweep is **budget-capped** (`modalStagger.ts`): the per-block step shrinks so a
  seven-block dialog takes about as long as a two-block one — the same normalization the panel's page
  wave uses, added after the picker's entrance ran ~1s and read as sluggish next to a confirm dialog
  using "the same" animation.
- **Only the TOP modal draws a backdrop** (`modalStack.ts`). Each modal drawing its own scrim stacked
  two 45% blacks and two blurs when a dialog opened from inside a dialog, so the page went darker at
  every level and the modal still visible behind it was dimmed as if disabled. The stack makes it ONE
  scrim at any depth.
- **The two halves of a hand-over run COMPLEMENTARY curves**, because scrims composite
  multiplicatively: two 45% blacks at `a` and `b` give `1−(1−0.45a)(1−0.45b)`, so a plain cross-fade
  is lightest exactly halfway (`≈0.40` vs a single layer's `0.45` — the visible flash). Holding that
  product constant needs `a = (1 − 0.55/(1 − 0.45b))/0.45`; the leaving scrim gets `SCRIM_YIELD_EASE`,
  the returning one its mirror, and the arriving/leaving TOP scrim runs `linear` (its partner does the
  shaping). Fits the exact curve within ~3% of alpha. Swapping the scrims instantly instead keeps the
  background perfectly flat but snaps over the modal BELOW — which has no scrim before and a full one
  after — so overlapping is the right trade. A modal opening or closing ALONE keeps its original fade
  untouched, including the lingering `delay-150`.
- **Body scroll lock is COUNTED** (`bodyScrollLock.ts`): each modal saving/restoring `overflow` itself
  left the page unscrollable after nested dialogs closed, because React tears down outer-first and the
  inner one then restored the `hidden` it had captured.

`NotificationHost` is the top overlay (at `--z-notification`); coordinate any new floating layer
against this scale.

---

## 12. Radius, motion & Tailwind v4 tokens

- **Corner radius** — one standard, defined as semantic tokens in `index.css` (`--radius-*`):
  `rounded-card` (16px, surfaces: cards/menus/dialogs — matches the auth cards), `rounded-control`
  (12px, buttons/inputs/list & menu items), `rounded-chip` (8px, small chips/tags), and
  `rounded-full` for pills/avatars. Prefer these semantic names over raw `rounded-2xl/xl/lg` in new
  UI. Existing components already align numerically (2xl↔card, xl↔control); the lone outlier is
  `CustomButton` (`rounded-md`) — reconcile if you touch it.
- **Motion** — `--ease-settle` (`cubic-bezier(0.16,1,0.3,1)`) is the shared "ease into place" curve
  for reveals (the user menu, future popovers), used as `ease-[var(--ease-settle)]`.
- ⚠️ **Tailwind v4 transition trap:** `translate-*`/`scale-*`/`rotate-*` utilities emit the
  INDEPENDENT `translate`/`scale`/`rotate` CSS properties — `transition-transform` (or a
  `transition-[...,transform]` list) does NOT animate them, they SNAP. Transition the property by
  name: `transition-[opacity,translate]`, `transition-[color,scale]`, `transition-[rotate,color]`.
  (Bit us four times: select chevron, card glass rise, checkbox pop, sidebar collapse button.)
- ⚠️ **Never transition a `--tw-*` custom property** (`transition-[…,--tw-ring-color]`). Tailwind v4
  registers them `syntax: "*"`, which is NOT interpolable, so the value flips **discretely at the
  halfway point** — and worse, any real property that resolves it (a ring IS `box-shadow` in v4) sees
  its `var()` dependency change mid-flight and **restarts its own transition**, which reads as a jolt.
  Transition the REAL property instead: one `box-shadow` entry animates the ring colour and the shadow
  together, because they are the same property. (The agenda ticket's hover.)
- ⚠️ **Color-token trap:** there is **no `gray` token** in the `@theme` (only `gray-disabled`), so
  `text-gray`/`border-gray`/`placeholder-gray` are silently NO-OP classes (Tailwind v4 does not emit
  unknown utilities) and the style falls back — for borders that means `currentColor`, which made the
  empty select's underline invisible (its value text is `text-transparent`). The form primitives now
  use explicit colors (`border-black`, `text-gray-disabled`); some `placeholder-gray` usages remain
  and only "work" via the UA default. Never add a `-gray` utility without first defining the token (or
  use `gray-disabled`/`charcoal/NN`).
- **Hover wants ASYMMETRIC timing**, like every other motion here: quick and decisive in
  (`hover:duration-150` + a snappy decelerate), settling out over ~300ms on `--ease-settle`. One
  duration in both directions feels either sluggish entering or clipped leaving. And a 1px lift is
  below what the eye follows through an ease — use 2px (`-translate-y-0.5`) if the move is meant to be
  seen.
- **A label that REWRITES itself sequences, never cross-fades** (`morphSwap`): the outgoing copy is
  fully gone before the incoming one starts. Overlapping them is invisible on a short chip
  ("Pendiente" → "En ruta") and reads as double-vision the moment the strings are long
  (`Sin ubicación (opcional)` → a coordinate pair) — two different texts stacked on each other. The
  box still eases between the two widths throughout, so nothing jumps; only the fades are ordered.
  `MorphSwap` has a `block` mode for prose that must keep wrapping; the outgoing copy needs `w-full`
  there or it shrink-wraps and visibly re-breaks while fading.
- **Two buttons in one row must be the SAME component at the SAME size.** `Button` has an `xs` (36px)
  SUMMARY size for scannable cards; the agenda ticket's and the dashboard card's quick actions were
  hand-rolled `<button>`s at ~28px sitting beside a 44px `Button`, which reads as a mistake rather
  than a hierarchy. Never hand-roll a button next to a `Button`. `Button` does NOT size
  `startIcon`/`endIcon` — every call site passes `className="size-3.5"` (`sm`) or `"size-4"`.
