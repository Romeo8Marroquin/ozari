import type { TFunction } from 'i18next';

const KEY = 'modules.panel.dashboard.today';

/**
 * The small print under each "Hoy" figure — what the number is MADE of, in words. A bare total read
 * the same before and after the work (owner, 2026-11-13: "Pedidos abiertos 3, pero solo tengo 2" —
 * the third was collected but not yet marked finished). Every count is the API's; nothing is
 * derived here beyond the one subtraction that turns "scheduled / done" into "left".
 */

/** "Faltan 2 por entregar" / "Todas entregadas" / "Ninguna programada para hoy". */
export function scheduledTodayHint(
  t: TFunction,
  kind: 'deliveries' | 'collections',
  scheduled: number,
  done: number,
): string {
  if (scheduled === 0) return t(`${KEY}.noneScheduled`);
  const left = scheduled - done;
  return left > 0 ? t(`${KEY}.${kind}Left`, { count: left }) : t(`${KEY}.${kind}AllDone`);
}

/** Joins the non-empty parts with the app's middle dot, or falls back when there are none. */
const joinParts = (parts: (string | false)[], empty: string): string => {
  const shown = parts.filter((part): part is string => part !== false);
  return shown.length > 0 ? shown.join(' · ') : empty;
};

/** "1 entrega · 2 recolecciones" — which events are late — or that nothing is. */
export function overdueHint(t: TFunction, deliveries: number, collections: number): string {
  return joinParts(
    [
      deliveries > 0 && t(`${KEY}.overdueDeliveries`, { count: deliveries }),
      collections > 0 && t(`${KEY}.overdueCollections`, { count: collections }),
    ],
    t(`${KEY}.overdueNone`),
  );
}

/** "2 por entregar · 1 por finalizar" — what each open order is still waiting for. */
export function activeHint(
  t: TFunction,
  toDeliver: number,
  toCollect: number,
  toClose: number,
): string {
  return joinParts(
    [
      toDeliver > 0 && t(`${KEY}.activeToDeliver`, { count: toDeliver }),
      toCollect > 0 && t(`${KEY}.activeToCollect`, { count: toCollect }),
      toClose > 0 && t(`${KEY}.activeToClose`, { count: toClose }),
    ],
    t(`${KEY}.activeNone`),
  );
}
