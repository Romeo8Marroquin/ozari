import type { IconType } from 'react-icons';
import { HiOutlineCube, HiOutlineCog6Tooth } from 'react-icons/hi2';
import type { Role } from '@constants/Roles';

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

// The nav shows ONLY built modules. Now that Settings is real we start "seriously": Products +
// Settings (the placeholder Inicio/Pedidos/Clientes tabs were removed). A dashboard lands later;
// until then `/panel` defaults to `/panel/productos`.
export const PANEL_NAV: PanelNavItem[] = [
  { to: '/panel/productos', icon: HiOutlineCube, labelKey: 'products' },
  { to: '/panel/ajustes', icon: HiOutlineCog6Tooth, labelKey: 'settings' },
];

/**
 * The nav items visible to `role`, dropping any whose `roles` restriction the current role doesn't
 * satisfy. A `null` role (signed out — shouldn't happen inside the guarded panel) sees only the
 * unrestricted tabs. Pure + role-driven so the sidebar stays declarative.
 */
export function filterNavByRole(items: PanelNavItem[], role: Role | null): PanelNavItem[] {
  return items.filter((item) => !item.roles || (role !== null && item.roles.includes(role)));
}
