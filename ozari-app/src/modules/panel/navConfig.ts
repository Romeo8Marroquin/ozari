import type { IconType } from 'react-icons';
import {
  HiOutlineHome,
  HiOutlineCube,
  HiOutlineClipboardDocumentList,
  HiOutlineUsers,
  HiOutlineCog6Tooth,
} from 'react-icons/hi2';

/** The panel routes the sidebar links to (kept as a literal union so TanStack Link stays typed). */
export type PanelPath =
  | '/panel/inicio'
  | '/panel/productos'
  | '/panel/pedidos'
  | '/panel/clientes'
  | '/panel/ajustes';

export interface PanelNavItem {
  to: PanelPath;
  icon: IconType;
  /** Key under `modules.panel.nav.*`. */
  labelKey: string;
}

export const PANEL_NAV: PanelNavItem[] = [
  { to: '/panel/inicio', icon: HiOutlineHome, labelKey: 'dashboard' },
  { to: '/panel/productos', icon: HiOutlineCube, labelKey: 'products' },
  { to: '/panel/pedidos', icon: HiOutlineClipboardDocumentList, labelKey: 'orders' },
  { to: '/panel/clientes', icon: HiOutlineUsers, labelKey: 'customers' },
  { to: '/panel/ajustes', icon: HiOutlineCog6Tooth, labelKey: 'settings' },
];
