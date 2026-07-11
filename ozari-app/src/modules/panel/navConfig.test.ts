import { describe, expect, it } from 'vitest';
import { HiOutlineCube } from 'react-icons/hi2';
import { Role } from '@constants/Roles';
import { PANEL_NAV, filterNavByRole, type PanelNavItem } from './navConfig';

describe('PANEL_NAV', () => {
  it('lists only the built modules (products + settings), all reachable', () => {
    expect(PANEL_NAV.map((item) => item.to)).toEqual(['/panel/productos', '/panel/ajustes']);
  });
});

describe('filterNavByRole', () => {
  const items: PanelNavItem[] = [
    { to: '/panel/productos', icon: HiOutlineCube, labelKey: 'products' }, // unrestricted
    { to: '/panel/ajustes', icon: HiOutlineCube, labelKey: 'settings', roles: [Role.Admin] }, // admin-only
  ];

  it('keeps unrestricted items for any role, including null', () => {
    expect(filterNavByRole(items, Role.Employee).map((i) => i.to)).toEqual(['/panel/productos']);
    expect(filterNavByRole(items, null).map((i) => i.to)).toEqual(['/panel/productos']);
  });

  it('includes a role-restricted item only when the role is allowed', () => {
    expect(filterNavByRole(items, Role.Admin).map((i) => i.to)).toEqual([
      '/panel/productos',
      '/panel/ajustes',
    ]);
  });

  it('shows every real nav item to a staff member (none are restricted today)', () => {
    expect(filterNavByRole(PANEL_NAV, Role.Employee)).toHaveLength(PANEL_NAV.length);
  });
});
