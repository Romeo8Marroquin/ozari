import { describe, expect, it } from 'vitest';
import { HiOutlineCube } from 'react-icons/hi2';
import { Role } from '@constants/Roles';
import {
  PANEL_NAV,
  filterNavByRole,
  panelHomeFor,
  panelSectionFor,
  type PanelNavItem,
} from './navConfig';

describe('PANEL_NAV', () => {
  it('lists only the built modules (products + orders + preferences + settings), all reachable', () => {
    expect(PANEL_NAV.map((item) => item.to)).toEqual([
      '/panel/productos',
      '/panel/pedidos',
      '/panel/preferencias',
      '/panel/ajustes',
    ]);
  });

  it('restricts products to Admin + Client — a Driver never sees the products tab (Epic-2A)', () => {
    // A Driver's tabs are the orders agenda (their deliveries) + settings — never products.
    expect(filterNavByRole(PANEL_NAV, Role.Driver).map((i) => i.to)).toEqual([
      '/panel/pedidos',
      '/panel/ajustes',
    ]);
    expect(filterNavByRole(PANEL_NAV, Role.Admin).map((i) => i.to)).toEqual([
      '/panel/productos',
      '/panel/pedidos',
      '/panel/preferencias',
      '/panel/ajustes',
    ]);
    expect(filterNavByRole(PANEL_NAV, Role.Client).map((i) => i.to)).toEqual([
      '/panel/productos',
      '/panel/ajustes',
    ]);
  });

  it('keeps PREFERENCES strictly Admin — it changes how the business behaves for everyone', () => {
    // Ajustes stays personal (password, 2FA) and is open to every staff member; system configuration
    // is a different concern with a different audience.
    const visibleTo = (role: Role) => filterNavByRole(PANEL_NAV, role).map((i) => i.to);
    expect(visibleTo(Role.Admin)).toContain('/panel/preferencias');
    expect(visibleTo(Role.Driver)).not.toContain('/panel/preferencias');
    expect(visibleTo(Role.Client)).not.toContain('/panel/preferencias');
  });

  it('opens orders to Admin + Driver (row-scoped), still not to a Client', () => {
    expect(filterNavByRole(PANEL_NAV, Role.Admin).map((i) => i.to)).toContain('/panel/pedidos');
    expect(filterNavByRole(PANEL_NAV, Role.Driver).map((i) => i.to)).toContain('/panel/pedidos');
    expect(filterNavByRole(PANEL_NAV, Role.Client).map((i) => i.to)).not.toContain(
      '/panel/pedidos',
    );
  });
});

describe('filterNavByRole', () => {
  const items: PanelNavItem[] = [
    { to: '/panel/productos', icon: HiOutlineCube, labelKey: 'products' }, // unrestricted
    { to: '/panel/ajustes', icon: HiOutlineCube, labelKey: 'settings', roles: [Role.Admin] }, // admin-only
  ];

  it('keeps unrestricted items for any role, including null', () => {
    expect(filterNavByRole(items, Role.Driver).map((i) => i.to)).toEqual(['/panel/productos']);
    expect(filterNavByRole(items, null).map((i) => i.to)).toEqual(['/panel/productos']);
  });

  it('includes a role-restricted item only when the role is allowed', () => {
    expect(filterNavByRole(items, Role.Admin).map((i) => i.to)).toEqual([
      '/panel/productos',
      '/panel/ajustes',
    ]);
  });
});

describe('panelSectionFor', () => {
  it('resolves any nested products path to the products tab', () => {
    expect(panelSectionFor('/panel/productos')).toBe('/panel/productos');
    expect(panelSectionFor('/panel/productos/nuevo')).toBe('/panel/productos');
    expect(panelSectionFor('/panel/productos/7')).toBe('/panel/productos');
    expect(panelSectionFor('/panel/productos/7/editar')).toBe('/panel/productos');
  });

  it('resolves the other tabs and returns null for unknown paths', () => {
    expect(panelSectionFor('/panel/pedidos')).toBe('/panel/pedidos');
    expect(panelSectionFor('/panel/preferencias')).toBe('/panel/preferencias');
    expect(panelSectionFor('/panel/ajustes')).toBe('/panel/ajustes');
    expect(panelSectionFor('/panel')).toBeNull();
    expect(panelSectionFor('/sesion/inicio')).toBeNull();
  });
});

describe('panelHomeFor', () => {
  it('lands each role on its first visible tab: products for Admin/Client, the agenda for a Driver', () => {
    expect(panelHomeFor(Role.Admin)).toBe('/panel/productos');
    expect(panelHomeFor(Role.Client)).toBe('/panel/productos');
    expect(panelHomeFor(Role.Driver)).toBe('/panel/pedidos');
  });

  it('falls back to settings for a null (unreadable) role', () => {
    expect(panelHomeFor(null)).toBe('/panel/ajustes');
  });
});
