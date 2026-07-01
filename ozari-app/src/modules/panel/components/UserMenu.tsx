import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { IconType } from 'react-icons';
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineChevronDown,
  HiOutlineShieldCheck,
  HiOutlineUserCircle,
} from 'react-icons/hi2';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { decodeToken } from '@utils/jwt';
import { getFirstName, getInitials } from '@utils/nameFormat';
import { useMe, type MeData } from '../hooks/useMe';
import { usePanelNavigate } from '../PanelNavContext';
import LogoutConfirmModal from './LogoutConfirmModal';

// The on-brand keyboard focus indicator, matching the rest of the panel chrome (header, sidebar).
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 focus-visible:ring-offset-white';

// Backend RolesEnum (Client=1, Admin=2, Employee=3). The access token carries the role id, so we
// can label the pill instantly from the token while `/auth/me` (the name) is still in flight.
const ROLE_BY_ID: Record<number, MeData['role']> = { 1: 'Client', 2: 'Admin', 3: 'Employee' };

interface MenuAction {
  key: string;
  icon: IconType;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

/**
 * The header user pill and its dropdown. The pill shows the user's first name (from
 * `/auth/me`) + role (from the token, so it's instant), with GT-convention initials in the
 * avatar. Clicking opens an accessible menu.
 *
 * The menu is PORTALED to <body> on purpose: per the app's stacking doctrine (see index.css
 * `--z-*`), a header float must be able to paint over the structural sidebar, which a panel
 * nested inside the header's own stacking context could not. It's positioned under the pill
 * (right-aligned) and kept in place on scroll/resize while open.
 *
 * Accessibility: `aria-haspopup`/`aria-expanded`/`aria-controls` on the trigger; the panel is
 * a `role="menu"` with `role="menuitem"` children, full arrow/Home/End/Escape keyboard nav,
 * click-outside dismissal, and focus returned to the trigger on close. When closed it's
 * `inert`, so it's out of the tab order and the a11y tree entirely.
 *
 * "Seguridad" navigates to the settings page; "Mi perfil" is still an intentional placeholder
 * (its route doesn't exist yet) — but everything around them (design, motion, a11y) is production-ready.
 */
const UserMenu: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const { data: me, isLoading } = useMe();

  const [open, setOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  // While the profile is in flight we show a skeleton rather than a misleading placeholder
  // name — "Usuario" would read as real data. The role is the exception: it's known instantly
  // from the token, but we still skeleton it here so the whole identity block resolves at once.
  const loading = isLoading && !me;

  const fallbackName = t('modules.panel.user.fallbackName');
  const fullName = me?.fullName ?? '';
  const displayName = getFirstName(fullName) || fallbackName;
  const initials = getInitials(fullName) || getInitials(fallbackName);

  // A single shimmer bar, sized by the caller. `animate-pulse` is disabled for reduced-motion.
  const skeletonBar = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

  // Prefer the freshly-fetched role name; until then, derive it from the access token.
  const tokenRole = useMemo<MeData['role'] | undefined>(() => {
    const token = Storage.get<string>(StorageKeys.TOKEN);
    const payload = token ? decodeToken(token) : null;
    return payload?.userRole ? ROLE_BY_ID[payload.userRole] : undefined;
  }, []);
  const roleKey = me?.role ?? tokenRole ?? 'unknown';
  const roleLabel = t(`modules.panel.user.roles.${roleKey}`, {
    defaultValue: t('modules.panel.user.roles.unknown'),
  });

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Anchor the panel under the pill, right edges aligned. Recomputed on open and kept in sync
  // while open (a scroll or resize would otherwise leave it stranded).
  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Round to whole pixels: getBoundingClientRect() is often fractional, and a fixed panel on a
    // sub-pixel boundary renders text blurry and "snaps" a pixel when the open transition ends.
    setPos({ top: Math.round(rect.bottom + 8), right: Math.round(Math.max(8, window.innerWidth - rect.right)) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onReflow = () => updatePosition();
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, updatePosition]);

  // Move focus into the menu once it's open, and dismiss on any outside pointer press.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => itemRefs.current[0]?.focus());
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const actions: MenuAction[] = [
    {
      key: 'profile',
      icon: HiOutlineUserCircle,
      label: t('modules.panel.user.menu.profile'),
      // TODO(panel): navigate to the profile page once it exists.
      onSelect: () => {},
    },
    {
      key: 'security',
      icon: HiOutlineShieldCheck,
      label: t('modules.panel.user.menu.security'),
      onSelect: () => panelNavigate('/panel/ajustes'),
    },
    {
      key: 'signOut',
      icon: HiOutlineArrowRightOnRectangle,
      label: t('modules.panel.user.menu.signOut'),
      destructive: true,
      onSelect: () => setLogoutOpen(true),
    },
  ];

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Tab':
        // Tabbing out of a menu dismisses it; let focus move on naturally.
        setOpen(false);
        break;
    }
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-busy={loading}
        aria-label={
          loading
            ? t('modules.panel.actions.userMenu')
            : t('modules.panel.actions.userMenuFor', { name: displayName })
        }
        className={`flex cursor-pointer items-center gap-2.5 rounded-full p-1 pr-2.5 transition-colors hover:bg-charcoal/[0.05] sm:gap-3 sm:pr-3.5 ${FOCUS_RING}`}
      >
        {loading ? (
          <>
            <span aria-hidden className={`size-10 shrink-0 rounded-full ${skeletonBar}`} />
            <span className="hidden flex-col items-start gap-1.5 sm:flex">
              <span aria-hidden className={`h-3.5 w-24 ${skeletonBar}`} />
              <span aria-hidden className={`h-2.5 w-16 ${skeletonBar}`} />
            </span>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cream to-blossom text-base font-semibold text-charcoal shadow-sm"
            >
              {initials}
            </span>
            <span className="hidden flex-col items-start leading-tight sm:flex">
              <span className="max-w-[14ch] truncate text-[15px] font-medium text-charcoal">{displayName}</span>
              <span className="text-[13px] text-charcoal/50">{roleLabel}</span>
            </span>
          </>
        )}
        <HiOutlineChevronDown
          aria-hidden
          className={`hidden size-4 text-charcoal/40 transition-transform duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none sm:block ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={t('modules.panel.actions.userMenu')}
            aria-hidden={!open}
            inert={!open}
            onKeyDown={onMenuKeyDown}
            style={{ top: pos.top, right: pos.right }}
            // Motion is purely vertical: it drops DOWN into place on open and retracts UP on close
            // (no scale/diagonal drift — that was the source of the sub-pixel text jump). A tighter,
            // contained shadow keeps the panel grounded without a large soft halo.
            className={`fixed z-[var(--z-float-header)] w-64 rounded-card border border-charcoal/[0.07] bg-white p-1.5 shadow-[0_10px_26px_-14px_rgba(38,38,38,0.30)] transition-[opacity,translate] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${
              open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
            }`}
          >
            {/* Identity summary — presentational, not a menu item. */}
            <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
              {loading ? (
                <>
                  <span aria-hidden className={`size-[3.25rem] shrink-0 rounded-full ${skeletonBar}`} />
                  <span className="flex flex-1 flex-col gap-2 py-0.5">
                    <span aria-hidden className={`h-3.5 w-28 ${skeletonBar}`} />
                    <span aria-hidden className={`h-3 w-36 ${skeletonBar}`} />
                    <span aria-hidden className={`h-2.5 w-16 ${skeletonBar}`} />
                  </span>
                </>
              ) : (
                <>
                  <span
                    aria-hidden
                    className="grid size-[3.25rem] shrink-0 place-items-center rounded-full bg-gradient-to-br from-cream to-blossom text-lg font-semibold text-charcoal shadow-sm"
                  >
                    {initials}
                  </span>
                  {/* min-w-0 lets the flex child shrink so `truncate` (…) can engage on absurdly long
                      names/emails — the menu has a fixed width, so it degrades gracefully. */}
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[15px] font-semibold text-charcoal">{fullName || fallbackName}</span>
                    {me?.email && <span className="truncate text-[13px] text-charcoal/50">{me.email}</span>}
                    <span className="mt-1 truncate text-xs font-medium text-magenta">{roleLabel}</span>
                  </span>
                </>
              )}
            </div>

            <div aria-hidden className="mx-1 my-1 h-px bg-charcoal/[0.06]" />

            {actions.map((action, actionIndex) => {
              const Icon = action.icon;
              const isSignOut = action.destructive;
              // A hairline above the destructive action separates it from the neutral items.
              return (
                <div key={action.key}>
                  {isSignOut && <div aria-hidden className="mx-1 my-1 h-px bg-charcoal/[0.06]" />}
                  <button
                    ref={(element) => {
                      itemRefs.current[actionIndex] = element;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => {
                      action.onSelect();
                      close();
                    }}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-control px-2.5 py-2 text-sm transition-colors ${FOCUS_RING} ${
                      isSignOut
                        ? 'text-red-600 hover:bg-red-50 hover:text-red-700'
                        : 'text-charcoal/80 hover:bg-charcoal/[0.05] hover:text-charcoal'
                    }`}
                  >
                    <Icon aria-hidden className="size-5 shrink-0" />
                    {action.label}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}

      <LogoutConfirmModal open={logoutOpen} onClose={() => setLogoutOpen(false)} />
    </>
  );
};

export default UserMenu;
