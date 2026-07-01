import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronLeft, HiOutlineXMark } from 'react-icons/hi2';
import { PANEL_NAV, type PanelNavItem, type PanelPath } from '../navConfig';
import { usePanelChrome } from '../hooks/usePanelChrome';
import { usePanelNavigate } from '../PanelNavContext';
import BrandMark from './BrandMark';

// A plain primary click (no modifier keys, main button) is the one we intercept for the body
// transition; a modified/middle click (open-in-new-tab, etc.) is left to the browser + <Link>.
const isPlainClick = (event: React.MouseEvent): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

// Shared motion for the chrome (collapse rail + drawer): a slower, symmetric ease-in-out so it
// glides in and out instead of snapping at the start. Reused everywhere so the whole panel moves
// with one rhythm. `motion-reduce:transition-none` honors the OS "reduce motion" setting — the
// chrome then snaps between states instead of sliding (no movement, but fully functional).
const EASE = 'ease-[cubic-bezier(0.65,0,0.35,1)]';
const COLLAPSE_MOTION = `duration-[380ms] ${EASE} motion-reduce:transition-none`;
const DRAWER_MOTION = `duration-[300ms] ${EASE} motion-reduce:transition-none`;

// A consistent, on-brand keyboard focus indicator for every interactive control in the chrome.
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 focus-visible:ring-offset-white';

// Icons sit at a fixed offset (sidebar px-3 + item px-3.5 + half a 20px icon = 36px) so they're
// centered in the 72px collapsed rail (--spacing-sidebar-collapsed) AND never move when expanding
// — only the label fades in. If you retune that token, keep it at 72px or re-derive this offset.
const labelTransition = `overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] ${COLLAPSE_MOTION}`;

interface NavItemProps {
  item: PanelNavItem;
  collapsed: boolean;
  active: boolean;
  /** This item is the one being LEFT during a tab change — its tint fades out now (in step with the
   *  content exit), while the destination's fades in at the swap. Keeps the tint in the flow. */
  leaving?: boolean;
  onNavigate?: () => void;
  /** Glide the active pill to this item now (before the route commits), for a simultaneous start. */
  onActivate?: (target: HTMLElement) => void;
  /** Opt this link out of the router's view transition (see the drawer note in SidebarContent). */
  disableViewTransition?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({
  item,
  collapsed,
  active,
  leaving,
  onNavigate,
  onActivate,
  disableViewTransition,
}) => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const label = t(`modules.panel.nav.${item.labelKey}`);
  const Icon = item.icon;

  // Drive navigation through the panel's body transition instead of <Link>'s instant swap. The
  // active tab is a no-op (still closes the mobile drawer); modified clicks fall through to <Link>.
  // On a real move, glide the pill immediately so it travels with the body fade — not after it.
  const onClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    onNavigate?.();
    if (!active) {
      onActivate?.(event.currentTarget);
      panelNavigate(item.to);
    }
  };

  return (
    <Link
      to={item.to}
      onClick={onClick}
      viewTransition={disableViewTransition ? false : undefined}
      // Collapsed: the visible label is clipped away, so name the link explicitly + a hover
      // tooltip. Expanded: the visible text is the accessible name, so neither is needed.
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      // The active PILL is a single shared element that glides between items (see SidebarContent);
      // this marks the target it measures.
      data-active={active ? 'true' : undefined}
      className={`panel-nav-item group relative flex h-11 items-center rounded-xl px-3.5 transition-colors ${FOCUS_RING} ${
        active ? '' : 'hover:bg-charcoal/[0.04]'
      }`}
    >
      {/* The soft active tint is its OWN layer so it can cross-fade on its own (opacity) timing —
          gently in on the new item, out on the old — instead of popping. It's decoupled from the
          link's `transition-colors` so hover/text stay snappy while this settles softly. Marking the
          departing item `leaving` drops it here (at click) so it fades out with the content exit,
          while the destination lights up at the route swap with the content entrance. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 rounded-xl bg-magenta/[0.08] transition-opacity duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
          active && !leaving ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <Icon
        aria-hidden
        className={`relative size-5 shrink-0 transition-colors ${
          active ? 'text-magenta' : 'text-charcoal/55 group-hover:text-charcoal/80'
        }`}
      />
      <span
        className={`${labelTransition} relative text-sm font-medium ${
          active ? 'text-charcoal' : 'text-charcoal/70 group-hover:text-charcoal/90'
        } ${collapsed ? 'ml-0 max-w-0 opacity-0' : 'ml-3 max-w-[160px] opacity-100'}`}
      >
        {label}
      </span>
    </Link>
  );
};

interface SidebarContentProps {
  collapsed: boolean;
  variant: 'inline' | 'drawer';
  onClose?: () => void;
  onNavigate?: () => void;
}

// Active pill geometry: h-5 (20px) tall, inset 4px from the item's left edge (the old `left-1`).
const PILL_HEIGHT = 20;
const PILL_INSET = 4;

const SidebarContent: React.FC<SidebarContentProps> = ({ collapsed, variant, onClose, onNavigate }) => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const HOME: PanelPath = '/panel/inicio';

  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const firstRun = useRef(true);
  const pillVisible = useRef(false);
  // The tab being LEFT during a click-driven change (set on click), so its tint fades out with the
  // content exit; the destination lights up at the swap. Reset the moment the route commits — the
  // React "adjust state when a value changes during render" pattern (not an effect), so returning to
  // that tab later (even via browser back) correctly lights it up again.
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setLeavingKey(null);
  }
  const currentActiveKey = () => PANEL_NAV.find((navItem) => pathname.startsWith(navItem.to))?.to ?? null;

  // Position the single active pill over the active item, measuring its LAYOUT position (offset*,
  // so it's scroll-, transform-, and viewport-proof — correct on any size and after a rotation).
  // `animate` glides (the bounce); otherwise it snaps in place (first paint, re-appearing from a
  // no-active route, and on resize/rotate). Same code serves the expanded rail, collapsed rail, and
  // drawer, since all three are one vertical list. An explicit `target` lets a click glide the pill
  // to the just-clicked item immediately — before the route (and thus `data-active`) has changed —
  // so the pill and the body transition start together; the route commit then re-runs to the same
  // spot (a no-op glide).
  const positionPill = useCallback((animate: boolean, target?: HTMLElement) => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!pill) return;

    const active = target ?? nav?.querySelector<HTMLElement>('[data-active="true"]');
    if (!nav || !active) {
      pill.style.opacity = '0';
      pillVisible.current = false;
      return;
    }

    const x = active.offsetLeft + PILL_INSET;
    const y = active.offsetTop + active.offsetHeight / 2 - PILL_HEIGHT / 2;
    const transform = `translate(${x}px, ${y}px)`;

    if (animate) {
      pill.style.transform = transform; // glide (translate animates with the bounce)
      pill.style.opacity = '1';
    } else {
      pill.style.transition = 'none';
      pill.style.transform = transform;
      void pill.offsetHeight; // flush the snap before restoring the class transition
      pill.style.transition = '';
      pill.style.opacity = '1';
    }
    pillVisible.current = true;
  }, []);

  // Glide only for a genuine tab→tab change (already visible); snap otherwise.
  useLayoutEffect(() => {
    positionPill(!firstRun.current && pillVisible.current);
    firstRun.current = false;
  }, [pathname, collapsed, positionPill]);

  // Re-anchor (no animation) on resize / orientation change, so it stays perfectly placed.
  useEffect(() => {
    const onResize = () => positionPill(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [positionPill]);

  return (
    <div className="flex h-full flex-col">
      {/* Brand → home. The whole lockup (mark + wordmark) is a single link to the dashboard. The
          mark and wordmark share one accessible name (the brand), satisfying label-in-name, and the
          tile lifts + glows on hover as the affordance. The wordmark stays in the DOM when collapsed
          (just clipped to 0 width) so the link keeps its name in the icon-only rail too. */}
      <div className="flex h-[var(--spacing-header)] shrink-0 items-center px-3.5">
        <Link
          to={HOME}
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onNavigate?.();
            if (pathname !== HOME) {
              setLeavingKey(currentActiveKey());
              panelNavigate(HOME);
            }
          }}
          // Same reason as the nav items: no view transition, so the active pill glides for real.
          viewTransition={false}
          aria-label={t('modules.panel.brand')}
          title={collapsed ? t('modules.panel.brand') : undefined}
          className={`group flex items-center gap-3 rounded-xl ${FOCUS_RING}`}
        >
          <BrandMark className="transition duration-200 ease-out group-hover:scale-[1.06] group-hover:shadow-[0_1px_3px_rgba(38,38,38,0.12),0_0_12px_rgba(255,1,237,0.24)] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
          <span
            className={`${labelTransition} text-[17px] font-semibold tracking-tight text-charcoal ${
              collapsed ? 'ml-0 max-w-0 opacity-0' : 'max-w-[160px] opacity-100'
            }`}
          >
            {t('modules.panel.brand')}
          </span>
        </Link>
        {variant === 'drawer' && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('modules.panel.actions.closeMenu')}
            className={`ml-auto grid size-9 cursor-pointer place-items-center rounded-lg text-charcoal/55 transition-colors hover:bg-charcoal/[0.05] hover:text-charcoal ${FOCUS_RING}`}
          >
            <HiOutlineXMark aria-hidden className="size-5" />
          </button>
        )}
      </div>

      {/* Navigation — the body-separating right border lives HERE (not on the whole aside), so it
          starts at the header's baseline. The brand area above stays borderless and reads as one
          continuous chrome with the header. */}
      <nav
        ref={navRef}
        aria-label={t('modules.panel.actions.navigation')}
        // `relative` is the positioning context for the shared active pill (below). `overscroll-contain`
        // stops a scroll that reaches the nav's end from chaining to the page behind it (matters most
        // for the mobile drawer); `panel-scroll` gives a consistent thin scrollbar across browsers.
        className={`panel-scroll relative flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-3 ${
          variant === 'inline' ? 'border-r border-charcoal/[0.07]' : ''
        }`}
      >
        {/* The single active indicator. Positioned imperatively (see the layout effect above); it
            sits on top of the items' soft background. The bounce lives only here — a small overshoot
            ease so the pill "arrives" with a little life. Kept modest so even the first→last jump
            doesn't over-swing. Reduced-motion snaps. */}
        <span
          ref={pillRef}
          aria-hidden
          style={{ willChange: 'transform' }}
          // ease-in-out shape (smooth slow start → quicker middle → smooth settle) with a small
          // `>1` end control for a gentle overshoot — a little bounce, less than before. 250ms.
          className="pointer-events-none absolute left-0 top-0 z-10 h-5 w-1 rounded-full bg-magenta opacity-0 transition-[transform,opacity] duration-[250ms] ease-[cubic-bezier(0.42,0,0.5,1.17)] motion-reduce:transition-none"
        />
        {PANEL_NAV.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            collapsed={collapsed}
            active={pathname.startsWith(item.to)}
            leaving={item.to === leavingKey}
            onNavigate={onNavigate}
            onActivate={(target) => {
              positionPill(true, target);
              // Mark the tab we're leaving so its tint fades out now (with the content exit).
              setLeavingKey(currentActiveKey());
            }}
            // Opt every nav link out of the router's view transition. Two reasons: (1) in the mobile
            // drawer it would snapshot the still-open drawer and cross-fade a "ghost" duplicate; and
            // (2) on any variant it would cross-fade old/new page snapshots OVER the live DOM, hiding
            // the active pill's real translation (you'd see a fade between positions, not a glide).
            // Without it, the pill's own CSS transform transition animates cleanly.
            disableViewTransition
          />
        ))}
      </nav>
    </div>
  );
};

const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const { mode, collapsed, toggleCollapsed, mobileOpen, closeMobile } = usePanelChrome();
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Modal-drawer focus management. On open: remember what had focus (the hamburger) and move focus
  // to the drawer's first control. On close: return focus to that trigger so keyboard users aren't
  // dumped back at the top of the page. The closed drawer is also `inert` (below), removing it from
  // the tab order entirely.
  useEffect(() => {
    if (mode !== 'mobile') return;
    if (mobileOpen) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    } else {
      triggerRef.current?.focus();
      triggerRef.current = null;
    }
  }, [mode, mobileOpen]);

  // Keep Tab/Shift+Tab inside the open drawer (it's a modal). At each end, wrap to the other —
  // without this, Tab would walk out to the header controls sitting behind the overlay.
  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !drawerRef.current) return;
    const focusables = drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
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

  if (mode === 'mobile') {
    return (
      <>
        <div
          aria-hidden
          onClick={closeMobile}
          className={`fixed inset-0 z-[var(--z-float-sidebar)] bg-charcoal/45 backdrop-blur-[3px] transition-opacity ${DRAWER_MOTION} ${
            mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />
        <aside
          ref={drawerRef}
          inert={!mobileOpen}
          role="dialog"
          aria-modal="true"
          aria-label={t('modules.panel.brand')}
          onKeyDown={trapFocus}
          className={`fixed inset-y-0 left-0 z-[var(--z-float-sidebar)] w-[var(--spacing-sidebar-drawer)] border-r border-charcoal/[0.07] bg-white shadow-xl transition-transform ${DRAWER_MOTION} ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <SidebarContent variant="drawer" collapsed={false} onClose={closeMobile} onNavigate={closeMobile} />
        </aside>
      </>
    );
  }

  return (
    <aside
      className={`panel-sidebar relative z-[var(--z-sidebar)] flex shrink-0 flex-col bg-gradient-to-b from-white to-[#faf7fb] transition-[width] ${COLLAPSE_MOTION} ${
        collapsed ? 'w-[var(--spacing-sidebar-collapsed)]' : 'w-[var(--spacing-sidebar)]'
      }`}
    >
      <SidebarContent variant="inline" collapsed={collapsed} />

      {/* Collapse toggle — a round affordance centered on the corner (its midpoint sits on the
          header-bottom × sidebar-right intersection), straddling the edge: classic, discoverable,
          and clear of the bottom-left dev devtools button. Hover is a tactile lift (the fill stays
          solid white so the border lines never show through it). The offset stays derived from the
          header token: header height minus half the 28px (size-7) button = its centered midpoint. */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={t(collapsed ? 'modules.panel.actions.expand' : 'modules.panel.actions.collapse')}
        className={`absolute -right-3.5 top-[calc(var(--spacing-header)-0.875rem)] z-20 grid size-7 cursor-pointer place-items-center rounded-full border border-charcoal/10 bg-white text-charcoal/55 shadow-[0_2px_8px_rgba(38,38,38,0.14)] transition-[color,transform,box-shadow,border-color] duration-[260ms] ${EASE} hover:scale-110 hover:border-charcoal/20 hover:text-charcoal hover:shadow-[0_5px_14px_rgba(38,38,38,0.20)] ${FOCUS_RING}`}
      >
        <HiOutlineChevronLeft
          aria-hidden
          className={`size-4 transition-transform ${COLLAPSE_MOTION} ${collapsed ? 'rotate-180' : ''}`}
        />
      </button>
    </aside>
  );
};

export default Sidebar;
