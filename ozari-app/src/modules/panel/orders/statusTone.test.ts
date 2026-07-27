import { describe, expect, it } from 'vitest';
import { NEUTRAL_TONE, STATUS_COLOR_KEYS, statusTone } from './statusTone';

describe('statusTone', () => {
  it('maps every palette token to its own chip classes', () => {
    const tones = STATUS_COLOR_KEYS.map((key) => statusTone(key));
    expect(tones).toHaveLength(new Set(tones).size); // no token silently shares another's look
    expect(tones.every((tone) => tone !== NEUTRAL_TONE)).toBe(true);
    expect(statusTone('amber')).toContain('amber');
  });

  it('falls back to neutral for an absent or unknown token', () => {
    // A status the admin created with a token this build doesn't know yet must still render.
    expect(statusTone(undefined)).toBe(NEUTRAL_TONE);
    expect(statusTone('fucsia')).toBe(NEUTRAL_TONE);
    expect(statusTone('')).toBe(NEUTRAL_TONE);
  });
});
