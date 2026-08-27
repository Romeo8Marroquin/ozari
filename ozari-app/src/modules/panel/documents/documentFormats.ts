/**
 * The DATE and MONEY vocabulary a document speaks — built once, here, so a PDF and the screen it
 * came from format the same figures the same way.
 *
 * `es-GT` throughout: the document is handed to a Guatemalan client, not localised per viewer.
 * The currency SYMBOL is never baked in — it arrives from the order or the products the quote was
 * built from, per the repo-wide rule that no view hardcodes "Q".
 */
export const DOCUMENT_MONEY = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const DOCUMENT_DATE = new Intl.DateTimeFormat('es-GT', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** A delivery needs its hour; an issue date does not. */
export const DOCUMENT_DATE_TIME = new Intl.DateTimeFormat('es-GT', {
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
});

/** The `money` function the template takes, bound to one document's currency. */
export const documentMoney =
  (symbol: string) =>
  (amount: number): string =>
    `${symbol} ${DOCUMENT_MONEY.format(amount)}`;
