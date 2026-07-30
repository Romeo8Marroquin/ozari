import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HiOutlineXMark } from 'react-icons/hi2';
import { prefersReducedMotion } from '@utils/motion';
import { isFinePointerDevice } from '@utils/pointer';
import { collectStaggerTargets, playStaggerIn, playStaggerOut } from './modalStagger';
import { registerModal } from './modalRegistry';
import OverlayScrollbar from './OverlayScrollbar';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  /** Whether the modal is open. Drives the enter/exit animation and mount lifecycle. */
  open: boolean;
  /** Requested close (✕, backdrop, Escape). The parent owns `open`, so it decides. */
  onClose: () => void;
  /** Heading — rendered as the dialog's accessible name (`aria-labelledby`). */
  title?: React.ReactNode;
  /** Sub-text under the title — wired as `aria-describedby`. */
  description?: React.ReactNode;
  /** Body content. Optional: a simple confirm needs only `title`/`description`/`footer`. */
  children?: React.ReactNode;
  /** Action row, right-aligned at the bottom (e.g. Cancel + Confirm). */
  footer?: React.ReactNode;
  /** Max width. Defaults to `md`. All sizes are full-width minus a gutter on small screens. */
  size?: ModalSize;
  /**
   * Whether the user can dismiss the modal. All-or-nothing on purpose: when `true` (default) the
   * ✕, backdrop-click, and Escape are ALL available; when `false` NONE of them are (no ✕, backdrop
   * clicks do nothing, Escape is ignored) — the modal can then only be resolved by its own actions.
   */
  dismissible?: boolean;
  /**
   * Temporarily disable every dismissal path even when `dismissible`. Use while an async action is
   * in flight so the user can't close the modal mid-request.
   */
  locked?: boolean;
  /** `alertdialog` for confirmations that demand a response; `dialog` (default) otherwise. */
  role?: 'dialog' | 'alertdialog';
  /** Accessible name when there's no visible `title`. */
  'aria-label'?: string;
  /**
   * Optional out-ref to the panel element, for consumers that animate the modal's own content
   * between steps (see {@link useModalPhaseTransition}). The primitive still owns the panel; this
   * just exposes it so a multi-step modal can drive the shared sweep on the real `.modal-stagger`
   * nodes.
   */
  panelRef?: React.RefObject<HTMLDivElement | null>;
}

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  // Grows with the viewport: comfortable on phones, uses the room a laptop/desktop actually has
  // (so two-column form rows don't shrink into wrapped labels/errors when there's space).
  xl: 'max-w-md sm:max-w-xl lg:max-w-2xl',
};

// A graceful, unhurried open/close — long enough to read as deliberate, not a snap. The shell is
// CSS transitions on purpose (they retarget natively, so a rapid open/close/open never fights
// itself). The unmount window below is DERIVED from the three motions it must outlast — keep them
// in sync if any changes:
//   - the panel/backdrop CSS transition (`duration-300` in the classNames),
//   - its close `delay-150` (so the content sweeps out FIRST, clearly "gone" before the card),
//   - the GSAP content stagger-out (~0.22s + stagger; see `modalStagger`).
const PANEL_MS = 300;
const CLOSE_DELAY_MS = 150;
const DURATION = PANEL_MS + CLOSE_DELAY_MS + 30; // 480ms — small buffer past the slowest motion
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The app's single modal primitive. A centered dialog over a blurred scrim (matching the mobile
 * drawer's backdrop), portaled to <body> at the `--z-modal` layer — above all chrome and floating
 * menus, below notifications (see the stacking doctrine in index.css).
 *
 * Dismissal is a single all-or-nothing `dismissible` switch (✕ + backdrop + Escape together), with
 * a `locked` escape hatch that suspends it during in-flight async work. Handles the hard parts of an
 * accessible dialog: focus is moved in on open (to `[data-modal-autofocus]` if present, else the
 * first focusable), trapped while open, and restored to the opener on close; background scroll is
 * locked; `role`/`aria-modal`/`aria-labelledby`/`aria-describedby` are wired up. Smooth fade + rise,
 * reversed on close, disabled for reduced-motion. Content is free-form with a sensible default pad.
 */
const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  locked = false,
  role = 'dialog',
  'aria-label': ariaLabel,
  panelRef: externalPanelRef,
}) => {
  const { t } = useTranslation();

  // `entered` is the animation flag. Mount = open OR mid-exit (so the close animation can play);
  // `shown` = the fully-open visual state. Deriving both avoids a `mounted` state whose setter
  // would fire synchronously inside an effect.
  const [entered, setEntered] = useState(false);
  const mounted = open || entered;
  const shown = open && entered;

  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Attach the panel to our internal ref AND (if provided) the consumer's out-ref, so a multi-step
  // modal can reach the real panel to drive the step transition on its `.modal-stagger` nodes.
  const setPanelNode = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (externalPanelRef) externalPanelRef.current = node;
    },
    [externalPanelRef],
  );

  // Latest handlers/flags, read lazily by the key handler — so the open effect depends only on
  // `open` and doesn't tear down + re-focus when `locked`/`dismissible` toggle mid-request.
  const handlers = useRef({ onClose, dismissible, locked });
  useEffect(() => {
    handlers.current = { onClose, dismissible, locked };
  });

  // While open, register with the modal registry so a forced logout (or any global sweep) can close
  // this modal from the outside — reading the latest `onClose` lazily so it stays current.
  useEffect(() => {
    if (!open) return;
    return registerModal(() => handlers.current.onClose());
  }, [open]);

  // Play the enter transition a frame after mount; unmount a beat after close (the timeout also
  // covers reduced-motion, where no transitionend would ever fire). Layered over the panel's own
  // rise/fade, the content blocks (`.modal-stagger`) do a subtle staggered reveal — and the exact
  // reverse (last-first) on close, kept inside the unmount window. Gated on reduced motion.
  useEffect(() => {
    const panel = panelRef.current;
    const targets = panel ? collectStaggerTargets(panel) : { content: [], footer: null };
    const animate = !prefersReducedMotion() && (targets.content.length > 0 || !!targets.footer);

    if (open) {
      const raf = requestAnimationFrame(() => {
        setEntered(true);
        // Content sweeps in FROM THE LEFT (staggered top-to-bottom); the actions come in FROM THE
        // RIGHT — a horizontal reveal that suits a modal better than a vertical drop. Same sweep the
        // step transition reuses (see modalStagger).
        if (animate) playStaggerIn(targets);
      });
      return () => cancelAnimationFrame(raf);
    }

    // Exit = the mirror: content leaves TO THE LEFT (reverse order), actions TO THE RIGHT. Kept
    // inside the unmount window; the panel's own fade is `ease-in` (below) so this is visible, not
    // masked by the card vanishing instantly.
    if (animate) playStaggerOut(targets);
    const timer = window.setTimeout(() => setEntered(false), DURATION);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Open lifecycle: remember the opener, lock scroll, move focus in, trap Tab, wire Escape.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      // Focus ALWAYS moves into the dialog — that is what makes it a dialog (the trap has something
      // to trap, Escape works, screen readers announce it). WHERE it lands depends on the device:
      // a mouse/trackpad gets the marked field, so typing can start straight away; touch gets the
      // PANEL, because focusing an input there pops the on-screen keyboard over half the screen the
      // instant the dialog opens — unasked, and usually over the text explaining the decision.
      // Deliberately not "the first focusable" on touch either: that is often the same input.
      const target = isFinePointerDevice()
        ? (panel?.querySelector<HTMLElement>('[data-modal-autofocus]') ??
          panel?.querySelector<HTMLElement>(FOCUSABLE) ??
          panel)
        : panel;
      target?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && handlers.current.dismissible && !handlers.current.locked) {
        event.preventDefault();
        handlers.current.onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [open]);

  if (!mounted) return null;

  const canDismiss = dismissible && !locked;
  const handleBackdrop = () => {
    if (canDismiss) onClose();
  };

  return createPortal(
    <div className={`fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 ${shown ? '' : 'pointer-events-none'}`}>
      {/* Scrim — same look as the mobile drawer's backdrop. */}
      <div
        aria-hidden
        onClick={handleBackdrop}
        className={`absolute inset-0 bg-charcoal/45 backdrop-blur-[3px] transition-opacity duration-300 motion-reduce:transition-none ${
          shown ? 'opacity-100' : 'opacity-0 delay-150'
        }`}
      />

      <div
        ref={setPanelNode}
        // Focusable-by-script only: on touch the dialog itself takes focus rather than a field (see
        // the open lifecycle), which needs a target that never appears in the tab order.
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        // Capped to the viewport (minus the container gutter) and a flex column, so its body can
        // scroll rather than overflow off-screen on short/mobile screens. `overflow-hidden` keeps the
        // scrolling body clipped to the rounded corners. Small modals never reach the cap, so they
        // size to their content exactly as before.
        className={`relative z-[1] flex max-h-[calc(100dvh-2rem)] w-full ${SIZES[size]} flex-col overflow-hidden rounded-card bg-white shadow-[0_24px_60px_-20px_rgba(38,38,38,0.45)] transition duration-300 motion-reduce:transition-none ${
          shown
            ? 'translate-y-0 scale-100 opacity-100 ease-[var(--ease-settle)]'
            : 'translate-y-2 scale-[0.96] opacity-0 ease-in delay-150'
        }`}
      >
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
            aria-label={t('components.modal.close')}
            // `z-10` keeps the close button above the content blocks — the stagger leaves an inline
            // `transform` on the title/description, which promotes them to the positioned paint layer;
            // without this they'd paint over the (earlier-in-DOM) ✕ and swallow its hover/clicks.
            className="absolute right-3 top-3 z-10 grid size-9 cursor-pointer place-items-center rounded-control text-charcoal/45 transition-colors hover:bg-charcoal/[0.06] hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <HiOutlineXMark aria-hidden className="size-5" />
          </button>
        )}

        {/* A relative wrapper holds the scrolling body + the shared OverlayScrollbar as siblings, so
            the bar floats OVER the content (the app's single scrollbar: fades when idle, grows on
            hover). The body hides its native bar (`.no-native-scrollbar`). */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* The scrollable body: caps the modal to the screen and scrolls (with momentum, no chaining
              to the page behind) only when the content would otherwise overflow. `overflow-x-hidden`
              keeps the modal-stagger x-slide from spawning a horizontal scrollbar. */}
          <div
            ref={bodyRef}
            data-modal-body
            // `overflow-anchor: none` for the same reason as the panel's scroller: a dialog body
            // animates its own height (a step swap, a photo strip growing, a field-array row) and the
            // browser's anchoring would re-scroll mid-tween. Growth that must be seen asks for it.
            className="no-native-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [overflow-anchor:none] p-6"
          >
            {title && (
              <h2 id={titleId} className={`modal-stagger text-xl font-semibold text-charcoal ${dismissible ? 'pr-8' : ''}`}>
                {title}
              </h2>
            )}
            {description && (
              <p id={descId} className="modal-stagger mt-2 text-[15px] leading-relaxed text-charcoal/60">
                {description}
              </p>
            )}
            {/* Children are NOT auto-staggered as one block — a modal whose body wants a per-item reveal
                tags its own elements with `modal-stagger` (e.g. ChangePasswordModal's fields); they then
                join the same sweep as the title/description. */}
            {children && <div className="mt-4 text-[15px] text-charcoal/75">{children}</div>}
            {footer && (
              <div className="modal-stagger-footer mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{footer}</div>
            )}
          </div>
          <OverlayScrollbar target={bodyRef} />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
