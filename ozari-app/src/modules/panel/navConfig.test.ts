import { describe, expect, it } from 'vitest';
import { HiOutlineCube } from 'react-icons/hi2';
import { Role } from '@constants/Roles';
import { PANEL_NAV, filterNavByRole, panelHomeFor, type PanelNavItem } from './navConfig';

describe('PANEL_NAV', () => {
  it('lists only the built modules (products + settings), all reachable', () => {
    expect(PANEL_NAV.map((item) => item.to)).toEqual(['/panel/productos', '/panel/ajustes']);
  });

  it('restricts products to Admin + Client — a Driver never sees the tab (Epic-2A)', () => {
    expect(filterNavByRole(PANEL_NAV, Role.Driver).map((i) => i.to)).toEqual(['/panel/ajustes']);
    expect(filterNavByRole(PANEL_NAV, Role.Admin).map((i) => i.to)).toEqual([
      '/panel/productos',
      '/panel/ajustes',
    ]);
    expect(filterNavByRole(PANEL_NAV, Role.Client).map((i) => i.to)).toEqual([
      '/panel/productos',
      '/panel/ajustes',
    ]);
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
