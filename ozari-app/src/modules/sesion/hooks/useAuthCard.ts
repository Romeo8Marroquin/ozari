import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';

type AuthVariant = 'login' | 'register';

const GRADIENT_SELECTOR = '.rotational-asset';
const CARD_SELECTOR = '.principal-card';

// Tilt of the gradient panel in its settled state, and the opaque margin we keep
// around the card so the blurred edges never expose a white corner.
const TILT = 8; // degrees
const BLUR_MARGIN = 48; // px — covers blur-lg (~16px) spread + comfortable safety
const HEIGHT_SCALE = 1.17; // extra vertical coverage (width is already comfortable)
const MOBILE_BAND_LIFT = 22; // px — nudge the vertical-layout band slightly upward
const RAD = Math.PI / 180;

// Handoff of the outgoing card height across the login <-> register swap, so the
// incoming card can morph from the previous height instead of snapping (the two
// pages have different natural heights). Module-scoped because the leaving page
// unmounts before the entering page mounts. Timestamped (not consumed-on-read) so
// it survives React StrictMode's dev double-mount yet expires for any navigation
// that isn't the intended leave->enter sweep.
const CARD_HEIGHT_HANDOFF_TTL = 1200;
let cardHeightHandoff: { height: number; ts: number } | null = null;

const isMobileViewport = () => globalThis.matchMedia('(max-width: 767px)').matches;

type GradientState = { width: number; height: number; x: number; y: number; rotation: number };

// The gradient panel is sized/placed from the *actual* card so it adapts to any
// aspect ratio (narrow phone, wide 640-767 vertical, desktop). It's the smallest
// tilted rectangle that fully covers the card (+ blur margin), so the cream→blossom
// gradient reads across it instead of showing a single near-uniform slice.
//
// - cover: flat, centered, fully covering — the transition seam both pages share.
// - settled: same size, tilted, and shifted toward the icon side so the opposite
//   side reveals the white form. Because the size already covers the whole card when
//   centered, shifting toward the icon keeps that side's corners covered (more
//   margin) and only the far side uncovers — no exposed corner is possible.
const gradientGeometry = (
  container: HTMLElement,
  variant: AuthVariant,
  mobile: boolean,
): { cover: GradientState; settled: GradientState } | null => {
  const card = container.querySelector<HTMLElement>(CARD_SELECTOR);
  if (!card) return null;
  const rect = card.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  if (W === 0 || H === 0) return null;
  const cx = rect.left + W / 2;
  const cy = rect.top + H / 2;

  const cos = Math.cos(TILT * RAD);
  const sin = Math.sin(TILT * RAD);

  // Smallest rectangle (centered, tilted by TILT) that fully covers the card; height
  // gets an extra safety scale for more vertical breathing room.
  const width = W * cos + H * sin + 2 * BLUR_MARGIN;
  const height = (W * sin + H * cos + 2 * BLUR_MARGIN) * HEIGHT_SCALE;

  // The panel is `inset-0 m-auto`. When it's wider than the card, CSS auto-margins
  // can't go negative horizontally (LTR), so it pins LEFT and overflows right — its
  // untransformed centre sits (width−W)/2 to the RIGHT of the card centre. Vertically
  // auto-margins centre fine. So every x is shifted left by this amount to truly
  // centre, then the band offset is applied on top.
  const centerX = (width - W) / 2;

  const cover: GradientState = { width, height, x: -centerX, y: 0, rotation: 0 };
  const rotation = variant === 'login' ? -TILT : TILT;

  // Locate the colored/white split from the real columns (icon block vs form).
  const children = [...card.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
  const article = children.find((c) => c.querySelector('.article-element'));
  const form = children.find((c) => c.querySelector('.form-element'));

  let x: number;
  let y = 0;

  if (mobile) {
    // Vertical: icon block on top, white form below. Band = the panel's bottom edge,
    // placed in the gap between them. Horizontally centered (x = 0) so the panel keeps
    // full-width coverage and the gradient stays balanced.
    let bandY = -0.12 * H;
    if (article && form) {
      bandY = (article.getBoundingClientRect().bottom + form.getBoundingClientRect().top) / 2 - cy;
    }
    bandY -= MOBILE_BAND_LIFT;
    // bottom-edge centre y = y + (height/2)·cos  =>  y = bandY − (height/2)·cos
    y = bandY - (height / 2) * cos;
    x = -centerX; // keep the panel horizontally centred so the gradient stays balanced
  } else {
    // Horizontal: icon block on one side, white form on the other. Band = a vertical
    // edge of the panel, placed in the gap between the two columns.
    let articleOnLeft = variant === 'login';
    let bandX = 0;
    if (article && form) {
      const a = article.getBoundingClientRect();
      const f = form.getBoundingClientRect();
      articleOnLeft = a.left < f.left;
      const innerLeft = articleOnLeft ? a.right : f.right;
      const innerRight = articleOnLeft ? f.left : a.left;
      bandX = (innerLeft + innerRight) / 2 - cx;
    }
    // colored left  -> band is the RIGHT edge (+width/2), panel shifts left.
    // colored right -> band is the LEFT edge (−width/2), panel shifts right.
    const edge = articleOnLeft ? width / 2 : -width / 2;
    x = bandX - centerX - edge * cos;
  }

  return { cover, settled: { width, height, x, y, rotation } };
};

const useAuthCard = (variant: AuthVariant) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const formShift = variant === 'login' ? 15 : -15;
  const articleShift = variant === 'login' ? -15 : 15;

  useGSAP(
    () => {
      const container = containerRef.current;
      if (!container) return;
      const geo = gradientGeometry(container, variant, isMobileViewport());
      if (!geo) return;
      gsap.set(GRADIENT_SELECTOR, geo.cover);

      const card = container.querySelector<HTMLElement>(CARD_SELECTOR);
      const fromHeight =
        cardHeightHandoff && performance.now() - cardHeightHandoff.ts < CARD_HEIGHT_HANDOFF_TTL
          ? cardHeightHandoff.height
          : null;

      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
      if (card && fromHeight != null && Math.abs(fromHeight - card.offsetHeight) > 2) {
        // Card resizes to its natural height while the gradient settles (same beat).
        tl.fromTo(
          card,
          { height: fromHeight },
          { height: 'auto', duration: 0.5, ease: 'power3.inOut', clearProps: 'height' },
          0,
        );
      }
      tl.to(GRADIENT_SELECTOR, { ...geo.settled, duration: 0.5, ease: 'power3.inOut' }, 0);
      tl.from(
        '.form-element',
        { x: formShift, opacity: 0, stagger: 0.07, duration: 0.3 },
        '>-0.32',
      );
      tl.from(
        '.article-element',
        { x: articleShift, opacity: 0, stagger: 0.07, duration: 0.3 },
        '<+0.06',
      );
    },
    { scope: containerRef },
  );

  // Re-snap the settled geometry on any resize (the panel is derived from the card,
  // which changes with the viewport — including mobile<->desktop breakpoint crosses).
  useEffect(() => {
    const onResize = () => {
      const container = containerRef.current;
      if (!container) return;
      const geo = gradientGeometry(container, variant, isMobileViewport());
      const gradient = container.querySelector(GRADIENT_SELECTOR);
      if (!geo || !gradient) return;
      gsap.killTweensOf(gradient);
      gsap.set(gradient, geo.settled);
    };
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, [variant]);

  const leaveTo = (path: string) => {
    const container = containerRef.current;
    const card = container?.querySelector<HTMLElement>(CARD_SELECTOR);
    cardHeightHandoff = card ? { height: card.offsetHeight, ts: performance.now() } : null;
    const geo = container ? gradientGeometry(container, variant, isMobileViewport()) : null;

    const tl = gsap.timeline({ defaults: { ease: 'power3.in' } });
    tl.to('.form-element', { x: formShift, opacity: 0, stagger: 0.06, duration: 0.2 });
    tl.to(
      '.article-element',
      { x: articleShift, opacity: 0, stagger: 0.06, duration: 0.2 },
      '<+0.05',
    );
    if (geo) {
      tl.to(
        GRADIENT_SELECTOR,
        { ...geo.cover, duration: 0.42, ease: 'power3.inOut', onComplete: () => navigate({ to: path }) },
        '<+0.12',
      );
    } else {
      tl.call(() => navigate({ to: path }));
    }
  };

  const redirectAfterSuccess = (path: string) => {
    const container = containerRef.current;
    const geo = container ? gradientGeometry(container, variant, isMobileViewport()) : null;

    const tl = gsap.timeline({ defaults: { ease: 'power3.in' } });
    tl.to('.form-element', { x: formShift, opacity: 0, stagger: 0.06, duration: 0.2 });
    tl.to(
      '.article-element',
      { x: articleShift, opacity: 0, stagger: 0.06, duration: 0.2 },
      '<+0.05',
    );
    if (geo) {
      tl.to(GRADIENT_SELECTOR, { ...geo.cover, duration: 0.42, ease: 'power3.inOut' }, '<');
    }
    tl.to(
      '.principal-card',
      {
        y: 20,
        opacity: 0,
        scale: 0.95,
        duration: 0.4,
        onComplete: () => navigate({ to: path }),
      },
      '<',
    );
  };

  return { containerRef, leaveTo, redirectAfterSuccess };
};

export default useAuthCard;
