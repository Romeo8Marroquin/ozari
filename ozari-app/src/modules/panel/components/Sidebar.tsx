import { useEffect, useRef } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronLeft, HiOutlineXMark } from 'react-icons/hi2';
import { PANEL_NAV, type PanelNavItem } from '../navConfig';
import { usePanelChrome } from '../hooks/usePanelChrome';
import BrandMark from './BrandMark';

// Shared motion for the chrome (collapse rail + drawer): a slower, symmetric ease-in-out so it
// glides in and out instead of snapping at the start. Reused everywhere so the whole panel moves
// with one rhythm.
const EASE = 'ease-[cubic-bezier(0.65,0,0.35,1)]';
const COLLAPSE_MOTION = `duration-[380ms] ${EASE}`;
const DRAWER_MOTION = `duration-[350ms] ${EASE}`;

// A consistent, on-brand keyboard focus indicator for every interactive control in the chrome.
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 focus-visible:ring-offset-white';

// Icons sit at a fixed offset (sidebar px-3 + item px-3.5 + half a 20px icon = 36px) so they're
// centered in the 72px collapsed rail AND never move when expanding — only the label fades in.
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
        className={`absolute left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-magenta transition-all duration-300 ${
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
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-3.5">
        <BrandMark />
        <span
          className={`${labelTransition} text-[15px] font-bold tracking-tight text-charcoal ${
            collapsed ? 'ml-0 max-w-0 opacity-0' : 'max-w-[160px] opacity-100'
          }`}
        >
          {t('modules.panel.brand')}
        </span>
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
        className={`flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3 ${
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

  // When the drawer opens, move focus into it (its first control is the close button) so keyboard
  // and screen-reader users land inside the menu. The closed drawer is `inert` (below), which both
  // removes it from the tab order and pulls focus back out when it closes.
  useEffect(() => {
    if (mode === 'mobile' && mobileOpen) {
      drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [mode, mobileOpen]);

  if (mode === 'mobile') {
    return (
      <>
        <div
          aria-hidden
          onClick={closeMobile}
          className={`fixed inset-0 z-40 bg-charcoal/45 backdrop-blur-[3px] transition-opacity ${DRAWER_MOTION} ${
            mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />
        <aside
          ref={drawerRef}
          inert={!mobileOpen}
          aria-label={t('modules.panel.brand')}
          className={`fixed inset-y-0 left-0 z-50 w-[270px] border-r border-charcoal/[0.07] bg-white shadow-xl transition-transform ${DRAWER_MOTION} ${
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
      className={`panel-sidebar relative z-10 flex shrink-0 flex-col bg-gradient-to-b from-white to-[#faf7fb] transition-[width] ${COLLAPSE_MOTION} ${
        collapsed ? 'w-[72px]' : 'w-64'
      }`}
    >
      <SidebarContent variant="inline" collapsed={collapsed} />

      {/* Collapse toggle — a round affordance centered on the corner (its midpoint sits on the
          header-bottom × sidebar-right intersection), straddling the edge: classic, discoverable,
          and clear of the bottom-left dev devtools button. Hover is a tactile lift (the fill stays
          solid white so the border lines never show through it). */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={t(collapsed ? 'modules.panel.actions.expand' : 'modules.panel.actions.collapse')}
        className={`absolute -right-3.5 top-[50px] z-20 grid size-7 cursor-pointer place-items-center rounded-full border border-charcoal/10 bg-white text-charcoal/55 shadow-[0_2px_8px_rgba(38,38,38,0.14)] transition-[color,transform,box-shadow,border-color] duration-[260ms] ${EASE} hover:scale-110 hover:border-charcoal/20 hover:text-charcoal hover:shadow-[0_5px_14px_rgba(38,38,38,0.20)] ${FOCUS_RING}`}
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
