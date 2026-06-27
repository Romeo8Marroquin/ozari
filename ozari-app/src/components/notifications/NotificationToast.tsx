import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import React, { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VARIANT_STYLES } from './notificationConfig';
import { useNotificationStore, type NotificationItem } from './notificationStore';

interface NotificationToastProps {
  item: NotificationItem;
  /** Screen edge the title tab is anchored to (follows the host position). */
  align: 'left' | 'right';
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const TAB_RADIUS = 12;
const BODY_RADIUS = 16;
const FILLET = 13;

/**
 * Builds the SVG outline of the whole toast as a single shape: a title pill fused to
 * a wider body via a concave fillet (the "folder tab"). It's parameterized by the
 * current body width (`bodyW`) AND total height, both anchored to the pill's corner, so
 * the body literally unfolds out of the pill (width + height) and folds back into it —
 * that's what makes the enter/exit read as one integrated element instead of two.
 *
 * `W` is the surface box width (the final/full body width); the body is drawn against
 * the anchored edge (right edge `W` for right-align, left edge `0` for left-align).
 */
function buildClipPath(
  W: number,
  Ht: number,
  Wt: number,
  bodyW: number,
  totalH: number,
  align: 'left' | 'right',
): string {
  const bodyH = Math.max(0, totalH - Ht);
  const rt = Math.min(TAB_RADIUS, Wt / 2, Ht / 2);

  // While the body is barely there, draw just the rounded pill.
  if (bodyH < 0.75) {
    const x0 = align === 'right' ? W - Wt : 0;
    const x1 = align === 'right' ? W : Wt;
    return (
      `M ${x0 + rt} 0 H ${x1 - rt} A ${rt} ${rt} 0 0 1 ${x1} ${rt} V ${Ht - rt} ` +
      `A ${rt} ${rt} 0 0 1 ${x1 - rt} ${Ht} H ${x0 + rt} A ${rt} ${rt} 0 0 1 ${x0} ${Ht - rt} ` +
      `V ${rt} A ${rt} ${rt} 0 0 1 ${x0 + rt} 0 Z`
    );
  }

  const w = Math.max(bodyW, Wt);
  const r = Math.min(BODY_RADIUS, w / 2, bodyH / 2);
  const f = Math.max(0, Math.min(FILLET, bodyH, w - Wt - r));

  if (align === 'left') {
    // Pill spans [0, Wt]; body spans [0, w] (extends right of the pill).
    return (
      `M ${rt} 0 H ${Wt - rt} A ${rt} ${rt} 0 0 1 ${Wt} ${rt} V ${Ht - f} ` +
      `A ${f} ${f} 0 0 0 ${Wt + f} ${Ht} H ${w - r} A ${r} ${r} 0 0 1 ${w} ${Ht + r} ` +
      `V ${totalH - r} A ${r} ${r} 0 0 1 ${w - r} ${totalH} H ${r} A ${r} ${r} 0 0 1 0 ${totalH - r} ` +
      `V ${rt} A ${rt} ${rt} 0 0 1 ${rt} 0 Z`
    );
  }

  // Pill spans [W-Wt, W]; body spans [W-w, W] (extends left of the pill).
  const bx0 = W - w;
  return (
    `M ${W - Wt + rt} 0 H ${W - rt} A ${rt} ${rt} 0 0 1 ${W} ${rt} V ${totalH - r} ` +
    `A ${r} ${r} 0 0 1 ${W - r} ${totalH} H ${bx0 + r} A ${r} ${r} 0 0 1 ${bx0} ${totalH - r} ` +
    `V ${Ht + r} A ${r} ${r} 0 0 1 ${bx0 + r} ${Ht} H ${W - Wt - f} A ${f} ${f} 0 0 0 ${W - Wt} ${Ht - f} ` +
    `V ${rt} A ${rt} ${rt} 0 0 1 ${W - Wt + rt} 0 Z`
  );
}

/**
 * A single glassy "folder-tab" toast. The entire pill+body is ONE glass surface
 * (`surfaceRef`) shaped with a JS-measured `clip-path`, so the concave fillet and all
 * corners are continuous. Everything visual derives from one principal color.
 *
 * Lifecycle (owned here): the pill enters, the body is born out of it (height grows +
 * clip-path reveals + text fades in), a hover/focus-pausable timer drives auto-dismiss,
 * and the exit reverses it — body collapses back into the pill, then the pill leaves
 * while siblings glide up.
 */
const NotificationToast: React.FC<NotificationToastProps> = ({ item, align }) => {
  const { t } = useTranslation();
  const dismiss = useNotificationStore((state) => state.dismiss);

  const variant = VARIANT_STYLES[item.variant];
  const color = item.color ?? variant.color;
  const title = item.title ?? t(variant.titleKey);
  const Icon = variant.Icon;
  const isAssertive = item.variant === 'error' || item.variant === 'warning';

  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);

  const dimsRef = useRef({ W: 0, Wt: 0, Ht: 0, bodyH: 0 });
  const renderRef = useRef<(p: number) => void>(() => {});
  const progressRef = useRef<gsap.core.Tween | null>(null);
  const exitingRef = useRef(false);

  const playExit = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    progressRef.current?.kill();

    const onComplete = () => dismiss(item.id);

    if (prefersReducedMotion()) {
      gsap.to(rootRef.current, { opacity: 0, height: 0, marginBottom: 0, duration: 0.2, onComplete });
      return;
    }

    const proxy = { p: 1 };
    gsap
      .timeline({ onComplete })
      // Body collapses back into the pill while its text fades out.
      .to(messageRef.current, { opacity: 0, duration: 0.14, ease: 'power1.in' })
      .to(
        proxy,
        { p: 0, duration: 0.32, ease: 'power2.in', onUpdate: () => renderRef.current(proxy.p) },
        '-=0.05',
      )
      // The pill lingers a beat, then leaves; the slot collapses so siblings glide up.
      .to(rootRef.current, { opacity: 0, y: -8, scale: 0.95, duration: 0.22, ease: 'power2.in' }, '+=0.12')
      .to(rootRef.current, { height: 0, marginBottom: 0, duration: 0.2, ease: 'power2.inOut' }, '<');
  }, [dismiss, item.id]);

  useGSAP(
    () => {
      const surface = surfaceRef.current;
      const tab = tabRef.current;
      const body = bodyRef.current;
      if (!surface || !tab || !body) return;

      // Measure the toast at its natural full size, then lock the width so the body
      // can grow/shrink in height without the shape reflowing horizontally.
      gsap.set(body, { height: 'auto', opacity: 1 });
      gsap.set(surface, { width: 'auto' });
      const W = surface.offsetWidth;
      const Wt = tab.offsetWidth;
      const Ht = tab.offsetHeight;
      const bodyH = body.offsetHeight;
      dimsRef.current = { W, Wt, Ht, bodyH };
      gsap.set(surface, { width: W });

      // Render the shape + body at a given reveal progress `p` (0 = pill only). Both
      // the body width and height grow from the pill, so it unfolds from the corner.
      const render = (p: number) => {
        const clamped = Math.max(0, Math.min(1, p));
        const visibleBodyH = bodyH * clamped;
        const bodyW = Wt + (W - Wt) * clamped;
        body.style.height = `${visibleBodyH}px`;
        surface.style.clipPath = `path("${buildClipPath(W, Ht, Wt, bodyW, Ht + visibleBodyH, align)}")`;
        if (messageRef.current) {
          // Fade the text in late, once the shape is mostly unfolded.
          messageRef.current.style.opacity = `${Math.max(0, (clamped - 0.6) / 0.4)}`;
        }
      };
      renderRef.current = render;

      const reduce = prefersReducedMotion();
      if (reduce) {
        render(1);
        gsap.from(rootRef.current, { opacity: 0, duration: 0.2 });
      } else {
        render(0);
        const proxy = { p: 0 };
        gsap
          .timeline()
          .from(rootRef.current, { opacity: 0, y: -14, scale: 0.92, duration: 0.32, ease: 'power3.out' })
          .to(
            proxy,
            { p: 1, duration: 0.5, ease: 'power3.out', onUpdate: () => render(proxy.p) },
            '-=0.1',
          );
      }

      // The bottom progress bar both visualizes and drives the auto-dismiss.
      if (item.duration > 0 && timerRef.current) {
        progressRef.current = gsap.fromTo(
          timerRef.current,
          { scaleX: 0 },
          {
            scaleX: 1,
            transformOrigin: 'left center',
            duration: item.duration / 1000,
            ease: 'none',
            delay: reduce ? 0 : 0.7,
            onComplete: playExit,
          },
        );
      }
    },
    { scope: rootRef },
  );

  const pauseTimer = () => progressRef.current?.pause();
  const resumeTimer = () => {
    if (!exitingRef.current) progressRef.current?.resume();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
      event.preventDefault();
      playExit();
    }
  };

  const glassBg = `color-mix(in srgb, ${color} 10%, rgba(255, 255, 255, 0.74))`;
  const circleBg = `color-mix(in srgb, ${color} 18%, transparent)`;

  return (
    <div
      ref={rootRef}
      role={isAssertive ? 'alert' : 'status'}
      aria-live={isAssertive ? 'assertive' : 'polite'}
      aria-label={`${title}. ${item.message}`}
      tabIndex={0}
      onClick={playExit}
      onKeyDown={handleKeyDown}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
      onFocus={pauseTimer}
      onBlur={resumeTimer}
      className="mb-3 w-fit max-w-[min(360px,calc(100vw-2rem))] cursor-pointer outline-none"
      style={{ filter: 'drop-shadow(0 12px 28px rgba(0,0,0,0.18))' }}
    >
      <div
        ref={surfaceRef}
        className={`flex flex-col backdrop-blur-md ${align === 'right' ? 'items-end' : 'items-start'}`}
        style={{ background: glassBg }}
      >
        <div ref={tabRef} className="flex w-fit items-center gap-1.5 px-3 py-1.5">
          <span
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
            style={{ background: circleBg }}
          >
            <Icon size={11} color={color} aria-hidden />
          </span>
          <span className="whitespace-nowrap text-xs font-semibold leading-none" style={{ color }}>
            {title}
          </span>
        </div>

        <div ref={bodyRef} className="relative w-full overflow-hidden px-4 py-3">
          <p ref={messageRef} className="text-xs leading-relaxed text-neutral-600">
            {item.message}
          </p>
          {item.duration > 0 && (
            <div
              ref={timerRef}
              aria-hidden
              className="absolute bottom-0 left-0 h-[3px] w-full origin-left scale-x-0 opacity-70"
              style={{ background: color }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationToast;
