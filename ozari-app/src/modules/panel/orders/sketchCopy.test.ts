import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { sketchCapHint } from './sketchCopy';

const K = 'modules.panel.orderSketch.cap';
const t = i18next.t;

describe('sketchCapHint', () => {
  it('says nothing when no cap is known', () => {
    expect(sketchCapHint(t, undefined, true, 2)).toBeNull();
  });

  it('names the dates once the sketch has them, else today', () => {
    expect(sketchCapHint(t, 4, true, 1)).toEqual({ text: `${K}.dated`, warn: false });
    expect(sketchCapHint(t, 4, false, 1)).toEqual({ text: `${K}.today`, warn: false });
  });

  it('warns when nothing is takeable — for the dates, or for now', () => {
    expect(sketchCapHint(t, 0, true, 0)).toEqual({ text: `${K}.noneDated`, warn: true });
    expect(sketchCapHint(t, 0, false, 3)).toEqual({ text: `${K}.noneToday`, warn: true });
  });

  it('owns up to a line already ABOVE its cap — the form will trim it', () => {
    expect(sketchCapHint(t, 2, true, 5)).toEqual({ text: `${K}.over`, warn: true });
  });
});
