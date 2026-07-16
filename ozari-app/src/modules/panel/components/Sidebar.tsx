import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronLeft, HiOutlineXMark } from 'react-icons/hi2';
import {
  PANEL_NAV,
  filterNavByRole,
  panelSectionFor,
  type PanelNavItem,
  type PanelPath,
} from '../navConfig';
import { usePanelChrome } from '../hooks/usePanelChrome';
import { usePanelNavigate, usePanelNavPending } from '../PanelNavContext';
import { useRole } from '@hooks/useRole';
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
  /** Opt this link out of the router's view transition (see the drawer note in SidebarContent). */
  disableViewTransition?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ item, collapsed, active, leaving, onNavigate, disableViewTransition }) => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const label = t(`modules.panel.nav.${item.labelKey}`);
  const Icon = item.icon;

  // Drive navigation through the panel's body transition instead of <Link>'s instant swap; modified
  // clicks fall through to <Link>. EVERY plain click goes to the controller — it decides (no-op on
  // the settled active tab, retarget mid-transition, cancel when re-clicking the tab being left) —
  // so nothing is ever "blocked" here. The pill/tint follow the controller's `pending` state.
  const onClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    onNavigate?.();
    panelNavigate(item.to);
  };

  return (
    <Link
      to={item.to}
      onClick={onClick}
      /* v8 ignore next -- every nav link is rendered with disableViewTransition, so the `undefined` fallback is unreachable */
      viewTransition={disableViewTransition ? false : undefined}
      // Collapsed: the visible label is clipped away, so name the link explicitly + a hover
      // tooltip. Expanded: the visible text is the accessible name, so neither is needed.
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      // The active PILL is a single shared element that glides between items (see SidebarContent);
      // `data-nav-to` is how it finds this item's element for a given path (route-active or pending).
      data-active={active ? 'true' : undefined}
      data-nav-to={item.to}
      className={`panel-nav-item group relative flex h-11 items-center rounded-xl px-3.5 transition-[color,background-color,box-shadow] duration-200 ${FOCUS_RING} ${
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
        className={`relative size-5 shrink-0 transition-[color,background-color,box-shadow] duration-200 ${
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
  // Nav is role-filtered (a UX layer): hide tabs the current role can't use. `HOME` is the brand
  // link target and the default landing now that the dashboard placeholder is gone.
  const role = useRole();
  const visibleNav = filterNavByRole(PANEL_NAV, role);
  const HOME: PanelPath = '/panel/productos';

  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const firstRun = useRef(true);
  const pillVisible = useRef(false);
  // The chrome follows the transition controller's INTENT, not just the committed route: while a
  // tab change is in flight, `pending` is the destination — the pill/tint glide there immediately,
  // and glide back home for free if the move is cancelled (pending returns to null). All derived;
  // no imperative click bookkeeping.
  const pending = usePanelNavPending();
  const routeActiveKey = visibleNav.find((navItem) => pathname.startsWith(navItem.to))?.to ?? null;
  // The chrome animates by SECTION: a pending detail/create path resolves to its parent tab, so a
  // grid → detail move keeps the products pill and tint perfectly still (raw-path comparison used
  // to hide the pill — no nav item matches `/panel/productos/7` — and fade the tint out and back).
  const pendingSection = pending === null ? null : panelSectionFor(pending);
  // Where the pill should sit right now: the in-flight destination's tab, else the committed route.
  const visualTarget = pending === null ? routeActiveKey : pendingSection;
  // The tab being LEFT mid-transition — its tint fades out now (with the content exit), while the
  // destination's fades in. Null again the moment the move commits or is cancelled — and never set
  // for a same-section move (nothing is being left).
  const leavingKey = pending !== null && pendingSection !== routeActiveKey ? routeActiveKey : null;

  // Position the single active pill over a target item, measuring its LAYOUT position (offset*,
  // so it's scroll-, transform-, and viewport-proof — correct on any size and after a rotation).
  // `animate` glides (the bounce); otherwise it snaps in place (first paint, re-appearing from a
  // no-active route, and on resize/rotate). Same code serves the expanded rail, collapsed rail, and
  // drawer, since all three are one vertical list.
  const positionPill = useCallback((animate: boolean, targetPath: PanelPath | null) => {
    const nav = navRef.current;
    const pill = pillRef.current;
    /* v8 ignore next -- the pill span is always mounted while positioning runs; the null guard is defensive */
    if (!pill) return;

    const active = targetPath ? nav?.querySelector<HTMLElement>(`[data-nav-to="${targetPath}"]`) : null;
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

  // Glide only for a genuine target change while visible (tab→tab, an in-flight retarget, or a
  // cancel gliding home); snap otherwise. Keyed on `visualTarget`, so the pill starts moving the
  // moment a click lands — with the body exit, not after it.
  useLayoutEffect(() => {
    positionPill(!firstRun.current && pillVisible.current, visualTarget);
    firstRun.current = false;
  }, [visualTarget, collapsed, positionPill]);

  // Re-anchor (no animation) on resize / orientation change, so it stays perfectly placed.
  useEffect(() => {
    const onResize = () => positionPill(false, visualTarget);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [positionPill, visualTarget]);

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
            // The controller decides (no-op when already home, retarget/cancel mid-transition).
            panelNavigate(HOME);
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
            className={`ml-auto grid size-9 cursor-pointer place-items-center rounded-lg text-charcoal/55 transition-[color,background-color,box-shadow] duration-200 hover:bg-charcoal/[0.05] hover:text-charcoal ${FOCUS_RING}`}
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
        {visibleNav.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            collapsed={collapsed}
            active={pathname.startsWith(item.to)}
            leaving={item.to === leavingKey}
            onNavigate={onNavigate}
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
    /* v8 ignore next -- the open drawer always renders focusable links, so the empty-list guard is unreachable */
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
        className={`absolute -right-3.5 top-[calc(var(--spacing-header)-0.875rem)] z-20 grid size-7 cursor-pointer place-items-center rounded-full border border-charcoal/10 bg-white text-charcoal/55 shadow-[0_2px_8px_rgba(38,38,38,0.14)] transition-[color,scale,box-shadow,border-color] duration-[260ms] ${EASE} hover:scale-110 hover:border-charcoal/20 hover:text-charcoal hover:shadow-[0_5px_14px_rgba(38,38,38,0.20)] ${FOCUS_RING}`}
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
