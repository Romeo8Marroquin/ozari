import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import LogoMark from './LogoMark';

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The full-screen route loader — TanStack Router's `defaultPendingComponent`, shown while a route's
 * code-split chunk / loader data is still in flight (mostly on slow networks).
 *
 * On-brand with the rest of the surface language: the soft cream→blossom gradient of the auth cards
 * and error screens, plus the shared {@link LogoMark} isotype (never the cropped wordmark), inside a
 * calm accent ring.
 *
 * The loader *appears* instantly (the router's view transition only wraps the exit, when the route
 * commits), so it plays its OWN staggered entrance so nothing pops in: the gradient fades in, then
 * the mark scales up from 0.8, then the ring scales in from 0.5 and spins permanently — a smooth,
 * unhurried sequence. Under reduced motion it simply renders, static (the "if we don't have the
 * resources, just show the page" path). The exit stays the router's view-transition crossfade.
 */
export default function PageLoader() {
  const { t } = useTranslation();
  const section = useRef<HTMLElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const logo = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap
        .timeline()
        .from(section.current, { autoAlpha: 0, duration: 0.35, ease: 'power2.out' })
        .from(logo.current, { scale: 0.8, autoAlpha: 0, duration: 0.5, ease: 'power3.out' }, '-=0.1')
        .from(ring.current, { scale: 0.5, autoAlpha: 0, duration: 0.5, ease: 'power3.out' }, '-=0.25')
        // The permanent spin starts at the SAME instant as the ring's entrance (`'<'`), so the ring
        // fades/scales in already rotating instead of settling first and then starting to spin. Scale
        // and rotation are separate transform components, so the two ring tweens compose cleanly (and
        // it stays on GSAP so nothing fights a separate CSS animation).
        .to(ring.current, { rotate: 360, duration: 1.1, ease: 'none', repeat: -1 }, '<');
    },
    { scope: section },
  );

  return (
    <section
      ref={section}
      className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-cream via-white to-blossom"
    >
      <div
        role="img"
        aria-label={t('components.pageLoader.logo')}
        className="relative grid size-40 place-items-center md:size-48"
      >
        {/* Calm accent ring — the loading indicator (its spin is driven by the GSAP timeline). */}
        <span
          ref={ring}
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-charcoal/10 border-t-magenta/70"
        />
        <span ref={logo} className="block w-14 text-charcoal md:w-16">
          <LogoMark className="w-full" />
        </span>
      </div>
    </section>
  );
}
