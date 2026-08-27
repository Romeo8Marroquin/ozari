import { describe, expect, it } from 'vitest';
import { BANK_KEYS } from '../preferences/bankLogos';
import { BANK_LOGO_MAX_HEIGHT, bankLogoFor } from './bankLogoImages';
import { BANK_MARK_WIDTH } from './documentTheme';

/**
 * A PNG's own pixel dimensions, read from its IHDR chunk.
 *
 * The header is fixed-layout: an 8-byte signature, then a 4-byte length and the 4-byte type
 * `IHDR`, then width and height as big-endian 32-bit integers at byte 16 and 20. Reading them here
 * is what lets the slot-fit rule below be an ASSERTION rather than the comment in `documentTheme`
 * telling the next person to go and look at a render.
 */
function pngSize(dataUri: string): { width: number; height: number } {
  const bytes = Uint8Array.from(atob(dataUri.slice(dataUri.indexOf(',') + 1)), (char) =>
    char.charCodeAt(0),
  );
  const view = new DataView(bytes.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('bankLogoFor', () => {
  it('has no mark for an account with no bank chosen', () => {
    // "Sin logo" is always available and is what keeps `BANK_KEYS` from restricting which banks the
    // business may use — the document prints the account's name instead.
    expect(bankLogoFor(null)).toBeUndefined();
  });

  it('has no mark for a key we ship no asset for', () => {
    // A hand-edited or stale `bankKey` must degrade to the name, never to a broken image.
    expect(bankLogoFor('banco-inventado')).toBeUndefined();
  });

  it('ships a mark for every key the preferences form offers', () => {
    // The two lists are mirrored by hand (`BANK_KEYS` here and in the API's catalog registry), so a
    // bank added to the picker without its asset would save happily and then print nothing.
    for (const key of BANK_KEYS) {
      expect(bankLogoFor(key)?.src.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('gives each mark its OWN height rather than one shared size', () => {
    // Banrural spends most of its artwork on the device above a small wordmark; BAC's wordmark
    // fills its own box. At one height Banrural's name prints at half the size of BAC's, and the
    // row reads as a mistake rather than as two banks.
    expect(bankLogoFor('banrural')?.height).not.toBe(bankLogoFor('bac')?.height);
  });

  it('exposes the tallest height so every account number starts on the same line', () => {
    const heights = BANK_KEYS.map((key) => bankLogoFor(key)?.height ?? 0);
    expect(BANK_LOGO_MAX_HEIGHT).toBe(Math.max(...heights));
  });

  it('keeps every mark inside its slot at the height it prints at', () => {
    // A logo is sized by HEIGHT and takes whatever width its aspect gives it, so `height × aspect`
    // has to fit `BANK_MARK_WIDTH` or the slot crops the mark — which is how BAC's "CREDOMATIC"
    // lost its last letter the first time these were embedded. This is the check that would
    // otherwise be "look at a render".
    for (const key of BANK_KEYS) {
      const logo = bankLogoFor(key);
      /* v8 ignore next -- unreachable: the test above already proves every key ships a mark. */
      if (logo === undefined) throw new Error(`${key} ships no logo`);
      const { width, height } = pngSize(logo.src);
      expect(logo.height * (width / height)).toBeLessThanOrEqual(BANK_MARK_WIDTH);
    }
  });

  it('carries marks small enough to ride in the lazy PDF chunk', () => {
    // The owner's originals were a 6650×3500 press asset (474 KB) and a 967×330 one. They are
    // downscaled to ~4× the box they print in: enough for a zoom and a home printer, and nothing
    // like enough to notice beside the half-megabyte renderer they load with.
    for (const key of BANK_KEYS) {
      const logo = bankLogoFor(key);
      /* v8 ignore next -- unreachable, as above. */
      if (logo === undefined) throw new Error(`${key} ships no logo`);
      expect(pngSize(logo.src).width).toBeLessThanOrEqual(320);
      expect(logo.src.length).toBeLessThan(40_000);
    }
  });
});
