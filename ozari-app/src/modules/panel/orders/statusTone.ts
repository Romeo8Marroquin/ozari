/**
 * The status palette: `colorKey` TOKEN → Tailwind classes.
 *
 * The lifecycle machine lives in data (the admin renames, recolors, reorders and adds steps), but
 * the DESIGN stays in code — the backend only ever stores a token from this fixed palette, and this
 * map is the single place it becomes colour. A status with no key, or one whose key this build
 * doesn't know yet (a newer backend palette), renders NEUTRAL rather than breaking the chip.
 *
 * Each token carries BOTH of its looks in one entry — the soft chip and the solid progress-rail fill
 * — so a token can never exist in one surface and be missing from the other.
 */
const TONES: Record<string, { chip: string; fill: string }> = {
  amber: { chip: 'bg-amber-50 text-amber-600', fill: 'bg-amber-400' },
  indigo: { chip: 'bg-indigo-50 text-indigo-600', fill: 'bg-indigo-400' },
  emerald: { chip: 'bg-emerald-50 text-emerald-600', fill: 'bg-emerald-400' },
  sky: { chip: 'bg-sky-50 text-sky-600', fill: 'bg-sky-400' },
  violet: { chip: 'bg-violet-50 text-violet-600', fill: 'bg-violet-400' },
  rose: { chip: 'bg-rose-50 text-rose-600', fill: 'bg-rose-400' },
  red: { chip: 'bg-red-50 text-red-500', fill: 'bg-red-400' },
  slate: { chip: 'bg-slate-100 text-slate-600', fill: 'bg-slate-400' },
};

/** The neutral fallback — an unknown/absent token must never break the chip. */
export const NEUTRAL_TONE = 'bg-charcoal/5 text-charcoal/60';

/** The neutral rail fill — same rule as the chip: unknown tokens stay readable, never invisible. */
export const NEUTRAL_FILL = 'bg-charcoal/35';

/** Every token this build can render — the admin palette picker's source (Phase 4). */
export const STATUS_COLOR_KEYS = Object.keys(TONES);

const toneOf = (colorKey?: string) =>
  colorKey !== undefined && colorKey !== '' ? TONES[colorKey] : undefined;

/** Chip classes for a status' configured `colorKey`. */
export const statusTone = (colorKey?: string): string => toneOf(colorKey)?.chip ?? NEUTRAL_TONE;

/** The SOLID fill of the progress rail's completed segments for a status' `colorKey`. */
export const statusFill = (colorKey?: string): string => toneOf(colorKey)?.fill ?? NEUTRAL_FILL;
