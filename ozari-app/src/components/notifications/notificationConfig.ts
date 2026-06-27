import type { IconType } from 'react-icons';
import { FiAlertTriangle, FiCheck, FiInfo, FiX } from 'react-icons/fi';

/**
 * The four predesigned notification variants. Each one is fully customizable at
 * call time (title, principal color, icon) — these are only the sensible defaults.
 * `success` is the default variant when none is provided.
 */
export type NotificationVariant = 'success' | 'error' | 'warning' | 'info';

export interface VariantStyle {
  /** Principal color the whole pill is derived from (icon, title, glass tint, timer). */
  color: string;
  /** Default icon for the variant (overridable per notification). */
  Icon: IconType;
  /** i18n key for the default short title (overridable per notification). */
  titleKey: string;
}

export const VARIANT_STYLES: Record<NotificationVariant, VariantStyle> = {
  success: { color: '#16a34a', Icon: FiCheck, titleKey: 'components.notifications.success' },
  error: { color: '#dc2626', Icon: FiX, titleKey: 'components.notifications.error' },
  warning: { color: '#d97706', Icon: FiAlertTriangle, titleKey: 'components.notifications.warning' },
  info: { color: '#2563eb', Icon: FiInfo, titleKey: 'components.notifications.info' },
};

/** Default time (ms) a toast stays before auto-dismissing. `0` = sticky. */
export const DEFAULT_DURATION = 5000;

/**
 * Default cap on toast width (px). Below it the toast is fit-content; at it the
 * message wraps to multiple lines. Overridable per notification via `maxWidth`/`width`.
 */
export const DEFAULT_MAX_WIDTH = 400;
