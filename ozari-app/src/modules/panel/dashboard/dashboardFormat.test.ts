import { describe, expect, it } from 'vitest';
import {
  deltaTone,
  formatMonthLabel,
  formatMoney,
  freshnessLabel,
  relativeKey,
  relativeTime,
  secondsSince,
} from './dashboardFormat';

describe('formatMoney', () => {
  it('always shows cents, grouped', () => {
    expect(formatMoney('Q', 12400)).toBe('Q 12,400.00');
    expect(formatMoney('Q', 0)).toBe('Q 0.00');
  });
});

describe('formatMonthLabel', () => {
  it('reads the parts LOCALLY — `new Date("2026-08")` is UTC and would shift the label', () => {
    // Guatemala is UTC-6, so a UTC-parsed "2026-08" renders as July for this user. Parsing the
    // parts keeps every bar labelled with its own month.
    expect(formatMonthLabel('2026-08')).toBe(
      new Intl.DateTimeFormat('es-GT', { month: 'short' }).format(new Date(2026, 7, 1)),
    );
  });

  it('falls back to the raw key rather than rendering "Invalid Date"', () => {
    expect(formatMonthLabel('nonsense')).toBe('nonsense');
    expect(formatMonthLabel('2026-')).toBe('2026-');
  });
});

describe('deltaTone', () => {
  it('maps the sign to a direction', () => {
    expect(deltaTone({ current: 2, previous: 1, deltaPercent: 100 })).toBe('up');
    expect(deltaTone({ current: 1, previous: 2, deltaPercent: -50 })).toBe('down');
    expect(deltaTone({ current: 1, previous: 1, deltaPercent: 0 })).toBe('flat');
  });

  it('is `none` when there is nothing to compare against', () => {
    expect(deltaTone({ current: 500, previous: 0 })).toBe('none');
  });
});

describe('secondsSince', () => {
  const at = new Date('2026-08-01T12:00:00Z');

  it('is whole seconds of age', () => {
    expect(secondsSince(at.toISOString(), at.getTime() + 42_000)).toBe(42);
  });

  it('floors at zero — a device clock running ahead must not render a negative age', () => {
    expect(secondsSince(at.toISOString(), at.getTime() - 5_000)).toBe(0);
  });
});

describe('freshnessLabel', () => {
  it('counts in SECONDS below a minute — at a 60s refetch, minutes read "hace 0" forever', () => {
    // This is the bug it replaced: the label never left zero, so it said nothing about liveness.
    expect(freshnessLabel(25)).toEqual({ key: 'seconds', count: 25 });
    expect(freshnessLabel(59)).toEqual({ key: 'seconds', count: 59 });
  });

  it('reads "hace un momento" for the first ten seconds instead of flickering 1, 2, 3', () => {
    expect(freshnessLabel(0)).toEqual({ key: 'justNow', count: 0 });
    expect(freshnessLabel(9)).toEqual({ key: 'justNow', count: 0 });
  });

  it('steps up to minutes and hours — a backgrounded tab must not say "hace 154 minutos"', () => {
    expect(freshnessLabel(60)).toEqual({ key: 'minutes', count: 1 });
    expect(freshnessLabel(3599)).toEqual({ key: 'minutes', count: 59 });
    expect(freshnessLabel(3600)).toEqual({ key: 'hours', count: 1 });
    expect(freshnessLabel(9_240)).toEqual({ key: 'hours', count: 2 });
  });
});

describe('relativeTime', () => {
  const HOUR = 60;
  const DAY = HOUR * 24;

  it('collapses the next ten minutes into "ahora" — the exact minute there is noise', () => {
    expect(relativeTime(0)).toEqual({ direction: 'now', value: 0 });
    expect(relativeTime(10)).toEqual({ direction: 'now', value: 0 });
  });

  it('climbs to the biggest unit that still says something, into the FUTURE', () => {
    expect(relativeTime(45)).toEqual({ direction: 'future', unit: 'minutes', value: 45 });
    expect(relativeTime(90)).toEqual({ direction: 'future', unit: 'hours', value: 2 });
    expect(relativeTime(DAY)).toEqual({ direction: 'future', unit: 'days', value: 1 });
    expect(relativeTime(DAY * 45)).toEqual({ direction: 'future', unit: 'months', value: 2 });
    expect(relativeTime(DAY * 400)).toEqual({ direction: 'future', unit: 'years', value: 1 });
  });

  it('climbs the SAME ladder into the past — 16,047 minutes is "11 días", not a number', () => {
    // The bug this replaced rendered exactly that figure as "Atrasado 16047 minutos".
    expect(relativeTime(-16_047)).toEqual({ direction: 'past', unit: 'days', value: 11 });
    expect(relativeTime(-45)).toEqual({ direction: 'past', unit: 'minutes', value: 45 });
    expect(relativeTime(-90)).toEqual({ direction: 'past', unit: 'hours', value: 2 });
    expect(relativeTime(-DAY * 200)).toEqual({ direction: 'past', unit: 'months', value: 7 });
    expect(relativeTime(-DAY * 800)).toEqual({ direction: 'past', unit: 'years', value: 2 });
  });

  it('never rounds a late event into "ahora" — one minute late is still late', () => {
    expect(relativeTime(-1)).toEqual({ direction: 'past', unit: 'minutes', value: 1 });
  });

  it('always reports a POSITIVE magnitude, so the copy never strips a minus', () => {
    expect(relativeTime(-500).value).toBeGreaterThan(0);
  });
});

describe('relativeKey', () => {
  it('routes each direction to its own copy family', () => {
    expect(relativeKey({ direction: 'now', value: 0 })).toBe('countdown.now');
    expect(relativeKey({ direction: 'future', unit: 'hours', value: 3 })).toBe('countdown.hours');
    expect(relativeKey({ direction: 'past', unit: 'days', value: 11 })).toBe('overdue.days');
  });
});
