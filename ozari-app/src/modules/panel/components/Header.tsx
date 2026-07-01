import { useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HiOutlineBars3, HiOutlineBell } from 'react-icons/hi2';
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

  const current = PANEL_NAV.find((item) => pathname.startsWith(item.to));
  const title = t(`modules.panel.nav.${current?.labelKey ?? 'dashboard'}`);

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
            className={`-ml-1 grid size-10 cursor-pointer place-items-center rounded-xl text-charcoal/70 transition-colors hover:bg-charcoal/[0.05] hover:text-charcoal ${FOCUS_RING}`}
          >
            <HiOutlineBars3 aria-hidden className="size-6" />
          </button>
        )}
        <h1 className="truncate text-lg font-semibold text-charcoal">{title}</h1>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          aria-label={t('modules.panel.actions.notifications')}
          className={`relative grid size-10 cursor-pointer place-items-center rounded-xl text-charcoal/60 transition-colors hover:bg-charcoal/[0.05] hover:text-charcoal ${FOCUS_RING}`}
        >
          <HiOutlineBell aria-hidden className="size-5" />
          <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-magenta ring-2 ring-white" />
        </button>

        <UserMenu />
      </div>
    </header>
  );
};

export default Header;
