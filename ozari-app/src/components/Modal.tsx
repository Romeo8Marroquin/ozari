import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HiOutlineXMark } from 'react-icons/hi2';

type ModalSize = 'sm' | 'md' | 'lg';

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
}

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

// A graceful, unhurried open/close — long enough to read as deliberate, not a snap.
const DURATION = 300;
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
}) => {
  const { t } = useTranslation();

  // `entered` is the animation flag. Mount = open OR mid-exit (so the close animation can play);
  // `shown` = the fully-open visual state. Deriving both avoids a `mounted` state whose setter
  // would fire synchronously inside an effect.
  const [entered, setEntered] = useState(false);
  const mounted = open || entered;
  const shown = open && entered;

  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Latest handlers/flags, read lazily by the key handler — so the open effect depends only on
  // `open` and doesn't tear down + re-focus when `locked`/`dismissible` toggle mid-request.
  const handlers = useRef({ onClose, dismissible, locked });
  useEffect(() => {
    handlers.current = { onClose, dismissible, locked };
  });

  // Play the enter transition a frame after mount; unmount a beat after close (the timeout also
  // covers reduced-motion, where no transitionend would ever fire).
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
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
      const target =
        panel?.querySelector<HTMLElement>('[data-modal-autofocus]') ??
        panel?.querySelector<HTMLElement>(FOCUSABLE) ??
        panel;
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
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        className={`relative z-[1] w-full ${SIZES[size]} rounded-card bg-white p-6 shadow-[0_24px_60px_-20px_rgba(38,38,38,0.45)] transition duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.96] opacity-0'
        }`}
      >
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
            aria-label={t('components.modal.close')}
            className="absolute right-3 top-3 grid size-9 cursor-pointer place-items-center rounded-control text-charcoal/45 transition-colors hover:bg-charcoal/[0.06] hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <HiOutlineXMark aria-hidden className="size-5" />
          </button>
        )}

        {title && (
          <h2 id={titleId} className={`text-xl font-semibold text-charcoal ${dismissible ? 'pr-8' : ''}`}>
            {title}
          </h2>
        )}
        {description && (
          <p id={descId} className="mt-2 text-[15px] leading-relaxed text-charcoal/60">
            {description}
          </p>
        )}
        {children && <div className="mt-4 text-[15px] text-charcoal/75">{children}</div>}
        {footer && <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
