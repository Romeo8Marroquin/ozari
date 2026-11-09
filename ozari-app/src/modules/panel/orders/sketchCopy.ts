import type { TFunction } from 'i18next';

const KEY = 'modules.panel.orderSketch';

/**
 * The quiet line under a cart control: how far its quantity may go, and for WHICH dates — the
 * sketch's window once it has one ("Máx. 4 para las fechas del pedido"), else today's stock. A line
 * already ABOVE its cap (added before the dates were chosen) is told so, plainly: the form trims it to
 * what is left and says what it changed, so nothing here pretends otherwise. `null` = no known cap.
 */
export function sketchCapHint(
  t: TFunction,
  cap: number | undefined,
  dated: boolean,
  quantity: number,
): { text: string; warn: boolean } | null {
  if (cap === undefined) return null;
  if (quantity > cap && cap > 0) return { text: t(`${KEY}.cap.over`, { count: cap }), warn: true };
  if (cap === 0) return { text: t(dated ? `${KEY}.cap.noneDated` : `${KEY}.cap.noneToday`), warn: true };
  return { text: t(dated ? `${KEY}.cap.dated` : `${KEY}.cap.today`, { count: cap }), warn: false };
}
