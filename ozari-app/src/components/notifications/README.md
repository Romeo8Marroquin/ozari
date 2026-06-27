# Notifications (toast layer)

A self-contained, app-wide toast system built on the stack we already have —
**zustand** (queue), **GSAP** (animation), **react-icons** (icons), **i18next**
(copy). No third-party notification dependency.

## ⚠️ Floating-layer ownership

`NotificationHost` is the **only out-of-the-box floating overlay** in the app. It is
mounted once in `src/routes/__root.tsx`, renders into a `createPortal` on
`document.body`, and owns:

- **z-index `1000`** — the top floating layer.
- A `pointer-events-none` container (never blocks the page); each toast re-enables
  `pointer-events-auto` only for itself.

Anything new that floats (modals, popovers, command palettes…) must be coordinated
against this — pick a z-index deliberately relative to `1000` and keep the
click-through contract — so the overlay stack stays predictable. Update this note
when another floating layer is added.

## Usage

Imperative API (works in components, React Query callbacks, the axios interceptor —
anywhere), from `notify.ts`:

```ts
import { notify } from '@components/notifications/notify';

notify.success(message, { title });           // default variant
notify.error(message);
notify.warning(message, { duration: 0 });      // 0 = sticky until dismissed
notify.info(message, { color: '#7d5076' });    // override the principal color
notify.info(message, { maxWidth: 520 });       // raise the wrap cap (default 400px)
notify.info(message, { width: 320 });          // fixed width (forces multi-line)
const id = notify.push({ message, variant: 'success' });
notify.dismiss(id);
```

All user-facing strings must come from i18next (`t(...)`) — pass already-translated
text into `notify`.

## API errors → automatic toast (the policy)

Failed **mutations** (any non-GET request) automatically raise a friendly error toast —
wired once in the axios response interceptor (`@api/client`), not per call. The message
is the backend's own localized `message` (from `sendOzariError`); for cases the server
can't speak to we synthesize copy: no response → `errors.network`, `429` →
`errors.tooManyRequests`, `5xx` → `errors.server`, `401/403` → `errors.unauthorized`,
else `errors.generic`.

- **Reads (GET) stay silent** — queries / route-guard probes own their own empty/error
  states. The token-refresh round-trip is always silent.
- **Opt out** of the auto-toast on a request with `{ skipErrorNotification: true }` when
  the caller handles the error itself (inline UI, a custom toast, a silent retry).
- **Success is never automatic** — handle it per call (a success toast often comes with
  navigation/state changes). E.g. register success shows a toast and animates back to
  login; the toast survives the route change because the host lives at the router root.

So in the auth pages, **form validation** (Zod) is the only inline messaging; everything
that comes back from the backend (success or error) flows through this layer. A future
backend `subCode` could let the server tag an error "don't toast" — extend
`shouldNotifyError` to honor it.

## Design

- **Single principal color.** Per variant (`notificationConfig.ts`) or per call
  (`color`). Everything derives from it: icon, icon-circle background (~22% opacity),
  title, glass tint, the timer bar, and the focus ring.
- **Colored glass.** The surface is a **tint of the principal color** (~22%) over a light,
  translucent base (`rgba(255,255,255,0.55)`) plus `backdrop-blur` — frosted-white glass
  with a hint of the variant color, with the blurred backdrop showing through (real glass,
  not a washed flat panel), light enough to read over darker backgrounds.
- **Click-through transparent corner.** The bounding box is a rectangle but the toast is a
  folder-tab `clip-path`, so there's an empty corner beside the pill. The whole stack
  (host container + per-toast wrappers + the toast root) is `pointer-events-none`; ONLY the
  **clipped surface** is `pointer-events-auto`. Because `clip-path` also clips hit-testing,
  that corner is genuinely click-through — hover/click there reach the page behind and the
  timer doesn't pause. The root's handlers still fire via event bubbling from the surface.
- **Glassy folder tab — one integrated surface.** The whole pill+body is a **single**
  glass element (`surfaceRef`) shaped with a JS-measured `clip-path` (`buildClipPath`),
  so the concave fillet joining the pill to the body and all corners are continuous —
  not two stacked boxes. The tab anchors to the screen edge (right on desktop top-right,
  left on mobile top-center). The shadow is a `drop-shadow` filter on **the surface
  itself** (not an ancestor — see Implementation notes) so it follows the clipped shape
  (a `box-shadow` would be clipped away).
- **Timer bar.** A rounded (pill-ended) bar inset from the body edges; it both visualizes
  and drives the auto-dismiss (its `scaleX` tween's completion fires the exit).
- **Lifecycle (owned by `NotificationToast`).** The pill enters (fade + slide + scale)
  and the body is **born out of it in the same gesture** — the unfold starts the instant
  the pill begins arriving (heavy overlap, no dead beat between the two), growing in width
  and height from the pill's corner while the `clip-path` is rebuilt each frame and the
  text fades in late. A hover/focus-pausable timer bar drives auto-dismiss. The exit
  reverses it continuously: the body collapses back into the pill and the pill leaves on
  its tail while siblings glide up.
- **Sizing.** Height is always **fit-content** (the body settles back to `height: auto`
  after the birth, so it never clips — even if a web font loads late and reflows the
  text). Width is **fit-content up to `maxWidth`** (default `440px`), then the message
  wraps to multiple lines. Per call you can raise/lower `maxWidth` or pass a fixed
  `width` (which forces wrapping). All capped at `100vw − 2rem` so it never overflows the
  viewport — that single cap + fit-content is what keeps it correct across desktop,
  tablet, and phone (no per-breakpoint sizes needed); only the anchor flips (top-right ≥
  640px, top-center below).
- **Dismiss.** Auto after `duration`; click/tap anywhere on the toast; or
  `Enter`/`Space`/`Escape` when focused.
- **Accessibility.**
  - **Screen readers:** each toast is a live region — `role="status"` + `aria-live="polite"`
    for success/info, `role="alert"` + `aria-live="assertive"` for error/warning — plus
    `aria-atomic="true"` and an `aria-label` of `"<title>. <message>"`, so the whole toast
    is announced as one unit the moment it mounts (assertive for errors, politely queued
    otherwise). The icon and timer bar are `aria-hidden`.
  - **Keyboard:** the toast is a focus stop (`tabIndex=0`); `Enter`/`Space`/`Escape`
    dismiss it. The `focus-visible` indicator is an **SVG stroke of the exact same
    `clip-path` outline** (principal color) drawn as a sibling overlay — so a focused
    toast shows ONE continuous border around the whole folder-tab shape (never a
    rectangle, never two boxes). The ring is sized to the **surface's own pixel box** and
    its `d` is rebuilt every frame in `render()` (not just `settle()`), so a focused toast
    dismissed mid-life keeps the border glued to the shape through the entire collapse and
    fades out with it — no decoupling. It's `opacity-0` until `:focus-visible`, so mouse
    users don't see it. Toasts never steal focus on appear (WCAG 2.4.3).
  - **Timing (WCAG 2.2.1 / 2.2.2):** the auto-dismiss timer **pauses on hover and on
    focus**, so keyboard and pointer users get unlimited time to read; `duration: 0`
    makes a toast sticky.
  - **Motion:** honors `prefers-reduced-motion` (no birth/slide — just a quick fade).
- **Responsive.** Top-right ≥640px, top-center below.

## Implementation notes

- On mount the surface **width is locked first** (rounded up so a sub-pixel can't shave
  the text onto an extra line), and only **then** is the body height measured — so the
  birth animates straight to the real final height (single- or multi-line) with no jump
  when it settles. After the birth the body returns to `height: auto` (fit-content).
- The `clip-path` is rewritten imperatively per animation frame (a cheap path string),
  not via React state, to keep the birth/collapse at 60fps.
- **`backdrop-filter` gotcha:** the glass blur (`backdrop-blur`) and the `drop-shadow`
  live on the **same** element (the surface). A `filter` (or `transform`) on an
  **ancestor** flattens the backdrop and silently disables `backdrop-filter` on
  descendants — putting the shadow on the wrapper made the glass look crisp/washed. Keep
  both on the surface; do not move the shadow up to a wrapper.
- The focus ring is an SVG `<path>` whose `d` is set to the same clip string in `settle()`
  (sibling of the surface, `overflow-visible`, so it isn't clipped away).
