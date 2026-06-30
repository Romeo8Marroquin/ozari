import { useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HiOutlineBars3, HiOutlineBell, HiOutlineChevronDown } from 'react-icons/hi2';
import { PANEL_NAV } from '../navConfig';
import { usePanelChrome } from '../hooks/usePanelChrome';

const Header: React.FC = () => {
  const { t } = useTranslation();
  const { mode, openMobile } = usePanelChrome();
  const pathname = useLocation({ select: (location) => location.pathname });

  const current = PANEL_NAV.find((item) => pathname.startsWith(item.to));
  const title = t(`modules.panel.nav.${current?.labelKey ?? 'dashboard'}`);
  const userName = t('modules.panel.user.name');

  return (
    <header className="panel-header flex h-16 shrink-0 items-center justify-between gap-3 border-b border-charcoal/[0.07] bg-white px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {mode === 'mobile' && (
          <button
            type="button"
            onClick={openMobile}
            aria-label={t('modules.panel.actions.openMenu')}
            className="-ml-1 grid size-10 cursor-pointer place-items-center rounded-xl text-charcoal/70 transition-colors hover:bg-charcoal/[0.05] hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 focus-visible:ring-offset-white"
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
          className="relative grid size-10 cursor-pointer place-items-center rounded-xl text-charcoal/60 transition-colors hover:bg-charcoal/[0.05] hover:text-charcoal"
        >
          <HiOutlineBell className="size-5" />
          <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-magenta ring-2 ring-white" />
        </button>

        <button
          type="button"
          aria-label={t('modules.panel.actions.userMenu')}
          className="flex cursor-pointer items-center gap-2.5 rounded-full p-1 pr-2 transition-colors hover:bg-charcoal/[0.05] sm:pr-3"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cream to-blossom text-sm font-bold text-charcoal shadow-sm">
            {userName.charAt(0).toUpperCase()}
          </span>
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-sm font-medium text-charcoal">{userName}</span>
            <span className="text-[11px] text-charcoal/50">{t('modules.panel.user.role')}</span>
          </span>
          <HiOutlineChevronDown className="hidden size-4 text-charcoal/40 sm:block" />
        </button>
      </div>
    </header>
  );
};

export default Header;
