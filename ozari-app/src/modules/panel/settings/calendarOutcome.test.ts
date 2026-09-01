import { describe, expect, it } from 'vitest';
import { leadTimeKey, readCalendarOutcome, withoutCalendarOutcome } from './calendarOutcome';

describe('readCalendarOutcome', () => {
  it('reads the marker Google’s callback hands back', () => {
    // The consent flow leaves the app entirely and returns as a fresh page load, so there is no
    // mutation result to report from — the outcome arrives in the query string or not at all.
    expect(readCalendarOutcome('?calendario=conectado')).toBe('connected');
    expect(readCalendarOutcome('?calendario=error')).toBe('error');
  });

  it('clamps rather than rejects, like every other search param here', () => {
    expect(readCalendarOutcome('')).toBeUndefined();
    expect(readCalendarOutcome('?otra=cosa')).toBeUndefined();
    expect(readCalendarOutcome('?calendario=quizá')).toBeUndefined();
  });
});

describe('withoutCalendarOutcome', () => {
  it('strips the marker and keeps everything else', () => {
    // It has to go once read: a reload — or a bookmark of the page as it stands — would otherwise
    // announce a connection that happened days ago.
    expect(withoutCalendarOutcome('/panel/ajustes?calendario=conectado')).toBe('/panel/ajustes');
    expect(withoutCalendarOutcome('/panel/ajustes?calendario=error&tab=2')).toBe(
      '/panel/ajustes?tab=2',
    );
  });

  it('leaves a URL that never had one alone', () => {
    expect(withoutCalendarOutcome('/panel/ajustes')).toBe('/panel/ajustes');
  });
});

describe('leadTimeKey', () => {
  it('states the lead in the unit a person would say it in', () => {
    // 1440 is "un día", not "1440 minutos" — the point of showing it is to confirm the rule at a
    // glance, and a four-digit number is something you have to do arithmetic on.
    expect(leadTimeKey(1440)).toEqual({ key: 'days', count: 1 });
    expect(leadTimeKey(2880)).toEqual({ key: 'days', count: 2 });
    expect(leadTimeKey(120)).toEqual({ key: 'hours', count: 2 });
    expect(leadTimeKey(90)).toEqual({ key: 'minutes', count: 90 });
  });

  it('has its own words for "when it starts"', () => {
    expect(leadTimeKey(0)).toEqual({ key: 'atStart', count: 0 });
  });
});
