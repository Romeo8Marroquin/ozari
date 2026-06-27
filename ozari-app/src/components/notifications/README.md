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
- **Lifecycle (owned by `NotificationToast`).** The pill enters (fade + slide + scale),
  then the body is **born out of it** — its height grows while the same `clip-path` is
  rebuilt each frame from the current height and the text fades in. A
  hover/focus-pausable timer bar drives auto-dismiss. The exit reverses it: the body
  collapses back into the pill, the pill lingers a beat, then it leaves while siblings
  glide up.
- **Dismiss.** Auto after `duration`; click/tap anywhere on the toast; or
  `Enter`/`Space`/`Escape` when focused.
- **Accessibility.** `role="status"` + `aria-live="polite"` for success/info,
  `role="alert"` + `aria-live="assertive"` for error/warning; focusable; honors
  `prefers-reduced-motion`.
- **Responsive.** Top-right ≥640px, top-center below; width capped at
  `min(360px, 100vw − 2rem)`.

## Implementation notes

- The shape is measured once on mount (at natural full size), then the surface **width
  is locked** so the body can grow/shrink in height without the outline reflowing
  horizontally. Toasts are short-lived, so width is not re-measured on viewport resize;
  the root caps at `min(360px, 100vw − 2rem)` to stay on-screen.
- The `clip-path` is rewritten imperatively per animation frame (a cheap path string),
  not via React state, to keep the birth/collapse at 60fps.
