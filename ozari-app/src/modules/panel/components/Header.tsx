import { useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HiOutlineBars3 } from 'react-icons/hi2';
import { PANEL_NAV } from '../navConfig';
import { usePanelChrome } from '../hooks/usePanelChrome';
import UserMenu from './UserMenu';

// The same keyboard focus indicator used across the panel chrome, so every control in the header is
// visibly reachable by Tab — matching the sidebar's nav items, brand link, and toggle.
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 focus-visible:ring-offset-white';

const Header: React.FC = () => {
  const { t } = useTranslation();
  const { mode, openMobile } = usePanelChrome();
  const pathname = useLocation({ select: (location) => location.pathname });

  // Products is the default landing, so it's the sensible fallback title for any path that isn't a
  // known nav section (unreachable in practice — the panel only routes to built modules).
  const current = PANEL_NAV.find((item) => pathname.startsWith(item.to));
  const title = t(`modules.panel.nav.${current?.labelKey ?? 'products'}`);

  return (
    // `relative z-[var(--z-header)]` places the header in the app stacking order — above page
    // content, below the sidebar — per the layering doctrine in index.css.
    <header className="panel-header relative z-[var(--z-header)] flex h-[var(--spacing-header)] shrink-0 items-center justify-between gap-3 border-b border-charcoal/[0.07] bg-white px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {mode === 'mobile' && (
          <button
            type="button"
            onClick={openMobile}
            aria-label={t('modules.panel.actions.openMenu')}
            className={`-ml-1 grid size-10 cursor-pointer place-items-center rounded-xl text-charcoal/70 transition-[color,background-color,box-shadow] duration-200 hover:bg-charcoal/[0.05] hover:text-charcoal ${FOCUS_RING}`}
          >
            <HiOutlineBars3 aria-hidden className="size-6" />
          </button>
        )}
        <h1 className="panel-header-title truncate text-lg font-semibold text-charcoal">{title}</h1>
      </div>

      {/* No notification bell (owner, 2026-08-31). It was a button with no handler wearing a
          hard-coded unread dot — a permanent claim that something was waiting, made to the one user
          who could never clear it. There is deliberately nothing behind it either: the only
          recurring thing an admin must be told is a delivery or a collection, and that lands in
          their real calendar with a reminder (EPIC-2-CALENDAR), which works when the app is closed.
          An in-app centre earns its place when there is a SECOND person to notify (assignments,
          hand-offs) or a client portal — bring the bell back with that, not before. */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <UserMenu />
      </div>
    </header>
  );
};

export default Header;
