import bac from '@assets/banks/bac.png?inline';
import banrural from '@assets/banks/banrural.png?inline';
import { BANK_KEYS } from '../preferences/bankLogos';

/**
 * The bank marks the document prints: each one's base64 `data:` URI together with the HEIGHT it
 * prints at.
 *
 * **`?inline` rather than a plain import, deliberately.** A normal asset import gives Vite's
 * hashed URL, which react-pdf would then have to FETCH — and that fetch is a different problem in
 * each of the two places this template runs: in the browser it is a network request governed by the
 * CSP, and in `pnpm doc:preview` (a Vite SSR build run under Node) the URL points at a server that
 * does not exist, so the preview would silently render logo-less pages and stop being a preview.
 * A data URI is the same bytes in both, with nothing to configure and nothing to get wrong.
 *
 * **Only this module imports them**, and only `OrderDocument` imports this module — which is
 * loaded lazily on the download click. So the ~36 KB of base64 rides in the PDF chunk beside the
 * half-megabyte renderer that needs it, and never reaches an admin who does not ask for a document.
 * That is the same reason `preferences/bankLogos.ts` deliberately imports NEITHER file: the
 * preferences screen identifies an account by the name the admin gave it and draws no mark at all.
 *
 * **The height belongs to the mark, not to the layout.** A shared size only balances logos that
 * fill their own artwork to the same degree, and these do not: Banrural's lockup spends most of its
 * box on the sun-and-field device above a small wordmark (the name is ~29% of the file's height),
 * while BAC's wordmark fills ~64% of its own. Printed at one height, Banrural's name comes out at
 * half the size of BAC's and the row reads as a mistake. Matching the WORDMARKS is what makes two
 * marks read as equals, and no formula derives that from the pixels — so it is recorded per logo,
 * and pairing it with the image here means a mark can never be added without one.
 *
 * The PNGs are downscaled to 260px wide (~12–16 KB each) — roughly 4× the box they print in, which
 * survives a zoom and a home printer without carrying the multi-megapixel press originals the owner
 * supplied. Re-downscale rather than committing a full-resolution replacement.
 *
 * A key with no entry — including the always-available `null` — simply prints no mark, which is
 * what keeps `BANK_KEYS` from being a restriction on which banks the business may use.
 *
 * `bankLogoImages.test.ts` asserts the two rules a new mark has to satisfy: every key in
 * `BANK_KEYS` has an entry, and `height × aspect` fits `BANK_MARK_WIDTH` (past that the slot crops
 * the mark, which is how BAC's "CREDOMATIC" lost its last letter the first time these were used).
 */
interface BankMark {
  src: string;
  height: number;
}

const MARKS: Record<string, BankMark> = {
  banrural: { src: banrural, height: 32 },
  bac: { src: bac, height: 22 },
};

/** The tallest mark any row can print, DERIVED rather than restated: the deposit rows reserve this
 *  much for their mark slot so that a tall logo, a short one and a logo-less wordmark all put their
 *  account numbers on the same line. Adding a taller logo cannot silently break that. */
export const BANK_LOGO_MAX_HEIGHT = Math.max(...Object.values(MARKS).map((mark) => mark.height));

/* v8 ignore next 3 -- guards a list mismatch that cannot exist at runtime, only in a bad commit. */
if (import.meta.env.DEV && BANK_KEYS.some((key) => MARKS[key] === undefined)) {
  console.warn('[documents] a bank key in BANK_KEYS ships no logo asset');
}

/** The mark for a bank account's `bankKey`, or `undefined` when it has none — the always-available
 *  "Sin logo" case, and any key we ship no asset for. */
export const bankLogoFor = (bankKey: string | null): BankMark | undefined =>
  bankKey === null ? undefined : MARKS[bankKey];
