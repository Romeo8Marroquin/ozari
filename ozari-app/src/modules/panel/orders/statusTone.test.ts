import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_FILL,
  NEUTRAL_TONE,
  STATUS_COLOR_KEYS,
  statusFill,
  statusTone,
} from './statusTone';

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

describe('statusFill', () => {
  it('gives every token its own solid rail fill, in the same hue as its chip', () => {
    const fills = STATUS_COLOR_KEYS.map((key) => statusFill(key));
    expect(fills).toHaveLength(new Set(fills).size);
    expect(fills.every((fill) => fill !== NEUTRAL_FILL)).toBe(true);
    expect(statusFill('emerald')).toContain('emerald');
  });

  it('falls back to a READABLE neutral fill for an absent or unknown token', () => {
    expect(statusFill(undefined)).toBe(NEUTRAL_FILL);
    expect(statusFill('fucsia')).toBe(NEUTRAL_FILL);
    expect(statusFill('')).toBe(NEUTRAL_FILL);
  });
});
