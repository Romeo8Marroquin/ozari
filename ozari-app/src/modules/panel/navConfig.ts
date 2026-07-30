import type { IconType } from 'react-icons';
import {
  HiOutlineAdjustmentsHorizontal,
  HiOutlineClipboardDocumentList,
  HiOutlineCog6Tooth,
  HiOutlineCube,
} from 'react-icons/hi2';
import { Role } from '@constants/Roles';

/**
 * The panel routes the transition controller can navigate to (a literal union so TanStack Link
 * stays typed). Superset of the sidebar tabs: nested pages (e.g. the product create form, a
 * product's detail) are navigable through the same animated transition without being tabs — the
 * sidebar's `startsWith` matching keeps the parent tab lit for them. The template member is the
 * RESOLVED product-detail path (`/panel/productos/7`): TanStack's typed `to` doesn't know resolved
 * param paths, so `PanelLayout`'s two router calls carry a localized cast for it.
 */
export type PanelPath =
  | '/panel/productos'
  | '/panel/productos/nuevo'
  | `/panel/productos/${number}`
  | `/panel/productos/${number}/editar`
  | '/panel/pedidos'
  | '/panel/pedidos/nuevo'
  | `/panel/pedidos/${number}`
  | `/panel/pedidos/${number}/editar`
  | '/panel/preferencias'
  | '/panel/ajustes';

export interface PanelNavItem {
  to: PanelPath;
  icon: IconType;
  /** Key under `modules.panel.nav.*`. */
  labelKey: string;
  /**
   * The roles allowed to see this tab. Omitted ⇒ visible to any staff member who reaches the panel
   * (the panel is already staff-only). Present ⇒ the tab is hidden unless the current role is listed
   * (e.g. a future admin-only tab). This is a UX filter, not the security boundary.
   */
  roles?: readonly Role[];
}

/**
 * The roles allowed into the products section (Epic-2A, owner decision 2026-07-15): a Driver's job
 * is deliveries, not the catalog — they get "Mis entregas" when the orders epic lands. Single
 * source for the nav item AND the `/panel/productos*` route guards (the backend 403 is the real
 * boundary; this is the matching UX layer).
 */
export const PRODUCTS_ROLES: readonly Role[] = [Role.Admin, Role.Client];

/**
 * The roles allowed into the orders section — **Admin + Driver**: the backend list is now row-scoped
 * (an Admin sees every order — grouped MINE vs the rest — a Driver only their assigned deliveries),
 * so the tab + guard widened together with that scoping. A Client's "mis pedidos" tier is still
 * future. Single source for the nav tab AND the `/panel/pedidos` route guard, like `PRODUCTS_ROLES`.
 */
export const ORDERS_ROLES: readonly Role[] = [Role.Admin, Role.Driver];

/**
 * The roles allowed into system PREFERENCES — **Admin only** (owner decision, 2026-07-29). These
 * screens change how the business behaves for everyone: the spacing between deliveries, the washing
 * period, which event types and zones exist. A Driver reports what happened and a Client places
 * orders; neither configures the system.
 *
 * Deliberately separate from Ajustes, which stays PERSONAL (password, 2FA) — "my account" and "the
 * company's rules" don't belong under one heading. Single source for the nav tab AND the
 * `/panel/preferencias` route guard, like `PRODUCTS_ROLES`; the backend's Admin-only
 * `/api/preferences` routes remain the real boundary.
 */
export const PREFERENCES_ROLES: readonly Role[] = [Role.Admin];

// The nav shows ONLY built modules: Products + Orders (the agenda) + Settings. A dashboard lands
// later; until then `/panel` defaults to the first tab the role can see — products for Admin/Client,
// the orders agenda for a Driver (deliveries are their whole job; see `panelHomeFor`).
export const PANEL_NAV: PanelNavItem[] = [
  { to: '/panel/productos', icon: HiOutlineCube, labelKey: 'products', roles: PRODUCTS_ROLES },
  { to: '/panel/pedidos', icon: HiOutlineClipboardDocumentList, labelKey: 'orders', roles: ORDERS_ROLES },
  { to: '/panel/preferencias', icon: HiOutlineAdjustmentsHorizontal, labelKey: 'preferences', roles: PREFERENCES_ROLES },
  { to: '/panel/ajustes', icon: HiOutlineCog6Tooth, labelKey: 'settings' },
];

/**
 * Where bare `/panel` lands for `role`: the first nav tab the role is allowed to see (products for
 * Admin/Client, the orders agenda for a Driver), falling back to settings if the role somehow
 * matches nothing. Keeps the default-landing rule derived from the SAME role-visibility source as
 * the sidebar, so the two can never disagree.
 */
export function panelHomeFor(role: Role | null): PanelPath {
  /* v8 ignore next -- defensive `??`: the settings tab is unrestricted, so the list is never empty */
  return filterNavByRole(PANEL_NAV, role)[0]?.to ?? '/panel/ajustes';
}

/**
 * The nav items visible to `role`, dropping any whose `roles` restriction the current role doesn't
 * satisfy. A `null` role (signed out — shouldn't happen inside the guarded panel) sees only the
 * unrestricted tabs. Pure + role-driven so the sidebar stays declarative.
 */
export function filterNavByRole(items: PanelNavItem[], role: Role | null): PanelNavItem[] {
  return items.filter((item) => !item.roles || (role !== null && item.roles.includes(role)));
}

/**
 * The nav SECTION a panel path belongs to — the tab whose `to` prefixes it (the sidebar's
 * `startsWith` matching, shared): `/panel/productos/7/editar` → `/panel/productos`. This is the
 * identity the chrome animates BY: the header title and the sidebar pill/tint only move when the
 * section changes — navigating within one section (grid → detail → edit) must never animate the
 * same title out and back in, or fade the same tab's tint. `null` for a path outside every tab.
 */
export function panelSectionFor(path: string): PanelPath | null {
  return PANEL_NAV.find((item) => path.startsWith(item.to))?.to ?? null;
}
