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
  it('lists only the built modules (products + orders + settings), all reachable', () => {
    expect(PANEL_NAV.map((item) => item.to)).toEqual([
      '/panel/productos',
      '/panel/pedidos',
      '/panel/ajustes',
    ]);
  });

  it('restricts products to Admin + Client — a Driver never sees the tab (Epic-2A)', () => {
    expect(filterNavByRole(PANEL_NAV, Role.Driver).map((i) => i.to)).toEqual(['/panel/ajustes']);
    expect(filterNavByRole(PANEL_NAV, Role.Admin).map((i) => i.to)).toEqual([
      '/panel/productos',
      '/panel/pedidos',
      '/panel/ajustes',
    ]);
    expect(filterNavByRole(PANEL_NAV, Role.Client).map((i) => i.to)).toEqual([
      '/panel/productos',
      '/panel/ajustes',
    ]);
  });

  it('restricts orders to Admin only until the Client/Driver backend slices land', () => {
    expect(filterNavByRole(PANEL_NAV, Role.Client).map((i) => i.to)).not.toContain(
      '/panel/pedidos',
    );
    expect(filterNavByRole(PANEL_NAV, Role.Driver).map((i) => i.to)).not.toContain(
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
    expect(panelSectionFor('/panel/ajustes')).toBe('/panel/ajustes');
    expect(panelSectionFor('/panel')).toBeNull();
    expect(panelSectionFor('/sesion/inicio')).toBeNull();
  });
});

describe('panelHomeFor', () => {
  it("lands each role on its first visible tab: products for Admin/Client, settings for a Driver", () => {
    expect(panelHomeFor(Role.Admin)).toBe('/panel/productos');
    expect(panelHomeFor(Role.Client)).toBe('/panel/productos');
    expect(panelHomeFor(Role.Driver)).toBe('/panel/ajustes');
  });

  it('falls back to settings for a null (unreadable) role', () => {
    expect(panelHomeFor(null)).toBe('/panel/ajustes');
  });
});
