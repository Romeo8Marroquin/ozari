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

## Design

- **Single principal color.** Per variant (`notificationConfig.ts`) or per call
  (`color`). Everything derives from it: icon, icon-circle background (~18% opacity),
  title, glass tint (~10% over translucent white + `backdrop-blur`), and the timer bar.
- **Glassy folder tab — one integrated surface.** The whole pill+body is a **single**
  glass element (`surfaceRef`) shaped with a JS-measured `clip-path` (`buildClipPath`),
  so the concave fillet joining the pill to the body and all corners are continuous —
  not two stacked boxes. The tab anchors to the screen edge (right on desktop top-right,
  left on mobile top-center). The shadow is a `drop-shadow` filter on the wrapper so it
  follows the clipped shape (a `box-shadow` would be clipped away).
- **Lifecycle (owned by `NotificationToast`).** The pill enters (fade + slide + scale)
  and the body is **born out of it in the same gesture** — the unfold starts the instant
  the pill begins arriving (heavy overlap, no dead beat between the two), growing in width
  and height from the pill's corner while the `clip-path` is rebuilt each frame and the
  text fades in late. A hover/focus-pausable timer bar drives auto-dismiss. The exit
  reverses it continuously: the body collapses back into the pill and the pill leaves on
  its tail while siblings glide up.
- **Sizing.** Height is always **fit-content** (the body settles back to `height: auto`
  after the birth, so it never clips — even if a web font loads late and reflows the
  text). Width is **fit-content up to `maxWidth`** (default `400px`), then the message
  wraps to multiple lines. Per call you can raise/lower `maxWidth` or pass a fixed
  `width` (which forces wrapping). All capped at `100vw − 2rem` so it never overflows the
  viewport.
- **Dismiss.** Auto after `duration`; click/tap anywhere on the toast; or
  `Enter`/`Space`/`Escape` when focused.
- **Accessibility.**
  - **Screen readers:** each toast is a live region — `role="status"` + `aria-live="polite"`
    for success/info, `role="alert"` + `aria-live="assertive"` for error/warning — plus
    `aria-atomic="true"` and an `aria-label` of `"<title>. <message>"`, so the whole toast
    is announced as one unit the moment it mounts (assertive for errors, politely queued
    otherwise). The icon and timer bar are `aria-hidden`.
  - **Keyboard:** the toast is a focus stop (`tabIndex=0`); `Enter`/`Space`/`Escape`
    dismiss it; focus shows a visible `focus-visible` outline (we only suppress the
    outline for mouse users). Toasts never steal focus on appear (WCAG 2.4.3).
  - **Timing (WCAG 2.2.1 / 2.2.2):** the auto-dismiss timer **pauses on hover and on
    focus**, so keyboard and pointer users get unlimited time to read; `duration: 0`
    makes a toast sticky.
  - **Motion:** honors `prefers-reduced-motion` (no birth/slide — just a quick fade).
- **Responsive.** Top-right ≥640px, top-center below.

## Implementation notes

- The shape is measured once on mount (at natural full size), then the surface **width
  is locked** so the body can grow/shrink in height without the outline reflowing
  horizontally. Toasts are short-lived, so width is not re-measured on viewport resize;
  the root caps at `min(360px, 100vw − 2rem)` to stay on-screen.
- The `clip-path` is rewritten imperatively per animation frame (a cheap path string),
  not via React state, to keep the birth/collapse at 60fps.
