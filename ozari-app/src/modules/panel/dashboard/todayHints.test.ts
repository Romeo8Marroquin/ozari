import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { assertTranslationContract } from '../../../test/i18nContract';
import { activeHint, overdueHint, scheduledTodayHint } from './todayHints';

const K = 'modules.panel.dashboard.today';

// The contract-checked `t` (key exists, every placeholder supplied), rendering `key(count)` so the
// assertions see WHICH count each part was given.
const t = ((key: string, options?: Record<string, unknown>) => {
  assertTranslationContract(key, options);
  return options && 'count' in options ? `${key}(${String(options['count'])})` : key;
}) as unknown as TFunction;

describe('scheduledTodayHint', () => {
  it('says nothing is scheduled when the day is empty', () => {
    expect(scheduledTodayHint(t, 'deliveries', 0, 0)).toBe(`${K}.noneScheduled`);
  });

  it('counts what is LEFT, not the total', () => {
    expect(scheduledTodayHint(t, 'deliveries', 3, 1)).toBe(`${K}.deliveriesLeft(2)`);
    expect(scheduledTodayHint(t, 'collections', 1, 0)).toBe(`${K}.collectionsLeft(1)`);
  });

  it('says the day is done once every scheduled event is', () => {
    expect(scheduledTodayHint(t, 'deliveries', 2, 2)).toBe(`${K}.deliveriesAllDone`);
    expect(scheduledTodayHint(t, 'collections', 1, 1)).toBe(`${K}.collectionsAllDone`);
  });
});

describe('overdueHint', () => {
  it('says nothing is late', () => {
    expect(overdueHint(t, 0, 0)).toBe(`${K}.overdueNone`);
  });

  it('names only the kinds that are late', () => {
    expect(overdueHint(t, 2, 0)).toBe(`${K}.overdueDeliveries(2)`);
    expect(overdueHint(t, 0, 1)).toBe(`${K}.overdueCollections(1)`);
    expect(overdueHint(t, 1, 3)).toBe(`${K}.overdueDeliveries(1) · ${K}.overdueCollections(3)`);
  });
});

describe('activeHint', () => {
  it('says nothing is open', () => {
    expect(activeHint(t, 0, 0, 0)).toBe(`${K}.activeNone`);
  });

  it("the owner's case: two to deliver, one collected but not finished", () => {
    expect(activeHint(t, 2, 0, 1)).toBe(`${K}.activeToDeliver(2) · ${K}.activeToClose(1)`);
  });

  it('lists every non-empty part in pipeline order', () => {
    expect(activeHint(t, 5, 3, 1)).toBe(
      `${K}.activeToDeliver(5) · ${K}.activeToCollect(3) · ${K}.activeToClose(1)`,
    );
    expect(activeHint(t, 0, 2, 0)).toBe(`${K}.activeToCollect(2)`);
  });
});
