/**
 * The status chip palette: `colorKey` TOKEN → Tailwind classes.
 *
 * The lifecycle machine lives in data (the admin renames, recolors, reorders and adds steps), but
 * the DESIGN stays in code — the backend only ever stores a token from this fixed palette, and this
 * map is the single place it becomes colour. A status with no key, or one whose key this build
 * doesn't know yet (a newer backend palette), renders NEUTRAL rather than breaking the chip.
 */
const TONES: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  sky: 'bg-sky-50 text-sky-600',
  violet: 'bg-violet-50 text-violet-600',
  rose: 'bg-rose-50 text-rose-600',
  red: 'bg-red-50 text-red-500',
  slate: 'bg-slate-100 text-slate-600',
};

/** The neutral fallback — an unknown/absent token must never break the chip. */
export const NEUTRAL_TONE = 'bg-charcoal/5 text-charcoal/60';

/** Every token this build can render — the admin palette picker's source (Phase 4). */
export const STATUS_COLOR_KEYS = Object.keys(TONES);

/** Chip classes for a status' configured `colorKey`. */
export const statusTone = (colorKey?: string): string =>
  (colorKey !== undefined && TONES[colorKey]) || NEUTRAL_TONE;
