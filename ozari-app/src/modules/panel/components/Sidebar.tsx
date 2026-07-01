import { useEffect, useRef } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronLeft, HiOutlineXMark } from 'react-icons/hi2';
import { PANEL_NAV, type PanelNavItem } from '../navConfig';
import { usePanelChrome } from '../hooks/usePanelChrome';
import BrandMark from './BrandMark';

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
  onNavigate?: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ item, collapsed, active, onNavigate }) => {
  const { t } = useTranslation();
  const label = t(`modules.panel.nav.${item.labelKey}`);
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      // Collapsed: the visible label is clipped away, so name the link explicitly + a hover
      // tooltip. Expanded: the visible text is the accessible name, so neither is needed.
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`panel-nav-item group relative flex h-11 items-center rounded-xl px-3.5 transition-colors ${FOCUS_RING} ${
        active ? 'bg-magenta/[0.08]' : 'hover:bg-charcoal/[0.04]'
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-magenta transition-all duration-300 motion-reduce:transition-none ${
          active ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0'
        }`}
      />
      <Icon
        aria-hidden
        className={`size-5 shrink-0 transition-colors ${
          active ? 'text-magenta' : 'text-charcoal/55 group-hover:text-charcoal/80'
        }`}
      />
      <span
        className={`${labelTransition} text-sm font-medium ${
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

const SidebarContent: React.FC<SidebarContentProps> = ({ collapsed, variant, onClose, onNavigate }) => {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <div className="flex h-full flex-col">
      {/* Brand → home. The whole lockup (mark + wordmark) is a single link to the dashboard. The
          mark and wordmark share one accessible name (the brand), satisfying label-in-name, and the
          tile lifts + glows on hover as the affordance. The wordmark stays in the DOM when collapsed
          (just clipped to 0 width) so the link keeps its name in the icon-only rail too. */}
      <div className="flex h-[var(--spacing-header)] shrink-0 items-center px-3.5">
        <Link
          to="/panel/inicio"
          onClick={onNavigate}
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
        aria-label={t('modules.panel.actions.navigation')}
        // `overscroll-contain` stops a scroll that reaches the nav's end from chaining to the page
        // behind it (matters most for the mobile drawer); `panel-scroll` gives a consistent thin
        // scrollbar across browsers instead of each OS's native bar.
        className={`panel-scroll flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-3 ${
          variant === 'inline' ? 'border-r border-charcoal/[0.07]' : ''
        }`}
      >
        {PANEL_NAV.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            collapsed={collapsed}
            active={pathname.startsWith(item.to)}
            onNavigate={onNavigate}
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
