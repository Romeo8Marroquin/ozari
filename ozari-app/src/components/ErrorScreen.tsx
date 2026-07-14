import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { prefersReducedMotion } from '@utils/motion';
import { FiRefreshCw } from 'react-icons/fi';
import Button from './Button';
import LogoMark from './LogoMark';

export type ErrorScreenVariant = 'crash' | 'maintenance' | 'offline';

interface ErrorScreenProps {
  /** `crash` = an unexpected error (default); `maintenance` = backend down; `offline` = no internet. */
  variant?: ErrorScreenVariant;
  /** `screen` fills the viewport (boundary / overlay); `container` fills its parent (inline route slot). */
  fill?: 'screen' | 'container';
  /** Replace the default action button (e.g. the outage overlay injects its retry controls here). */
  action?: ReactNode;
  /** The default button's handler. Defaults to a full reload — right for an unrecoverable crash. */
  onAction?: () => void;
  /**
   * When this flips from `true` to `false`, the entrance timeline plays **in reverse** (everything
   * leaves in the opposite order it arrived) and `onExited` fires when done — so a recovering overlay
   * un-builds itself instead of just fading out. Default `true` (used by the crash/route screens,
   * which never exit). Only the outage overlay drives it.
   */
  visible?: boolean;
  onExited?: () => void;
}

/**
 * The app's shared error surface — friendly, not technical (leads with the brand logo, plain copy, no
 * "500/503" codes). A frosted hero card floats on the brand gradient with soft drifting colour blobs;
 * a festive wash covers the card's top (logo) half. Same palette as the auth screens, different
 * composition, so it feels part of the product without copying it.
 *
 * It **mounts in place** and plays a brisk (~0.5s) GSAP entrance; reduced motion shows it instantly and
 * stills the blobs. The `action` slot swaps the default reload button for richer controls (the outage
 * overlay's auto-retry + manual "Reintentar").
 */
const ErrorScreen: React.FC<ErrorScreenProps> = ({
  variant = 'crash',
  fill = 'screen',
  action,
  onAction,
  visible = true,
  onExited,
}) => {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  // The entrance timeline, kept so the exit can play it in reverse (the "un-build").
  const timeline = useRef<gsap.core.Timeline | null>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;

      // The band starts hidden + lifted, so its drop-in reads even before the timeline plays.
      gsap.set('.error-gradient', { autoAlpha: 0, y: -64 });

      // The WHOLE transition is one timeline (backdrop → card → band → logo → text → action), so the
      // exit can simply reverse it and everything leaves in the opposite order it arrived.
      timeline.current = gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from(container.current, { autoAlpha: 0, duration: 0.3 }, 0)
        .from('.error-card', { autoAlpha: 0, y: 20, scale: 0.97, duration: 0.6, ease: 'power3.out' }, 0)
        // Once the card is up, the colour band drops in from above and fades up behind the logo —
        // a distinct beat (not simultaneous with the card) so the motion is clearly visible.
        .to('.error-gradient', { autoAlpha: 1, y: 0, duration: 0.55, ease: 'power2.out' }, 0.22)
        .from('.error-logo', { autoAlpha: 0, scale: 0.8, duration: 0.4, ease: 'back.out(1.7)' }, 0.34)
        .from('.error-line', { autoAlpha: 0, y: 10, duration: 0.3, stagger: 0.05 }, 0.46)
        .from('.error-action', { autoAlpha: 0, y: 8, duration: 0.28 }, 0.58);

      // Ambient: the decorative blobs drift gently and forever (independent of the entrance).
      gsap.to('.error-blob-a', { x: 26, y: -18, duration: 6, ease: 'sine.inOut', repeat: -1, yoyo: true });
      gsap.to('.error-blob-b', { x: -22, y: 20, duration: 7, ease: 'sine.inOut', repeat: -1, yoyo: true });
    },
    { scope: container },
  );

  // Exit: play the entrance backwards (reverse order, a touch quicker), then hand back to the caller.
  useEffect(() => {
    const tl = timeline.current;

    if (!visible) {
      if (!tl || prefersReducedMotion()) {
        onExited?.();
        return;
      }
      tl.eventCallback('onReverseComplete', () => onExited?.());
      tl.timeScale(1.5).reverse();
      return;
    }

    // Re-shown while it was still un-building (a new outage during the exit) — cancel the exit and
    // resume forward so the card doesn't get stuck half-reversed.
    if (tl && tl.reversed()) {
      tl.eventCallback('onReverseComplete', null);
      tl.timeScale(1).play();
    }
  }, [visible, onExited]);

  const handleAction = onAction ?? ((): void => window.location.reload());

  return (
    <section
      ref={container}
      className={`relative flex w-full items-center justify-center overflow-hidden px-6 py-16 ${
        fill === 'screen' ? 'min-h-dvh' : 'min-h-full flex-1'
      }`}
      style={{ background: 'radial-gradient(120% 120% at 50% 0%, #faf7fa 0%, #efeaf0 58%, #e7dced 100%)' }}
    >
      {/* Festive, out-of-focus colour blobs for depth — purely decorative. */}
      <div aria-hidden className="error-blob-a pointer-events-none absolute -left-16 -top-10 size-72 rounded-full bg-blossom/40 blur-3xl" />
      <div aria-hidden className="error-blob-b pointer-events-none absolute -bottom-16 -right-10 size-80 rounded-full bg-sky/40 blur-3xl" />

      <div
        role="alert"
        className="error-card relative z-10 w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-[0_16px_44px_-22px_rgba(38,38,38,0.32)] ring-1 ring-black/[0.04]"
      >
        {/* The auth cards' gradient panel (cream → blossom, `blur-lg`), the same essence as
            login/register's `.rotational-asset` on mobile — but STATIC (no rotation). It **bleeds past
            the top and sides** so the card's `overflow-hidden` clips those blurred edges (no white
            gaps); only the bottom edge stays inside, fading softly into the white below. */}
        <div
          aria-hidden
          className="error-gradient pointer-events-none absolute -left-10 -right-10 -top-10 h-60 bg-gradient-to-b from-cream to-blossom blur-lg"
        />

        <div className="relative flex flex-col items-center px-8 pb-10 pt-11 text-center sm:px-10">
          {/* Text-less isotype (no cropped wordmark), sized as a hero. Generous space below it. */}
          <LogoMark className="error-logo mb-10 w-28 text-charcoal" />

          <h1 className="error-line text-2xl font-bold text-charcoal sm:text-[28px]">
            {t(`errorScreen.${variant}.title`)}
          </h1>
          <p className="error-line mt-2.5 max-w-sm text-[15px] leading-relaxed text-charcoal/55">
            {t(`errorScreen.${variant}.message`)}
          </p>

          <div className="error-action mt-7 flex flex-col items-center gap-2">
            {action ?? (
              <Button
                color="#262626"
                onClick={handleAction}
                startIcon={<FiRefreshCw aria-hidden className="size-[18px]" />}
              >
                {t(`errorScreen.${variant}.action`)}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ErrorScreen;
