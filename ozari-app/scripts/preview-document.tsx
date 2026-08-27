/**
 * `pnpm doc:preview` — renders the order document from FIXTURE data to `scripts/preview.pdf`.
 *
 * A LOCAL-ONLY design tool, never bundled and never deployed. It exists because the template is the
 * one part of this feature a test cannot judge: `OrderDocument` is coverage-excluded precisely
 * because jsdom cannot drive react-pdf's layout engine, so "does it look right" has no assertion —
 * only a pair of eyes. Before this script, every visual change was a guess that took a round trip
 * through the running app, a login and a real order to evaluate.
 *
 * The fixture deliberately includes the awkward cases rather than a tidy one: a long product name
 * that must wrap, both a rental and a sale group, a discount, a deposit, and three bank accounts —
 * one more than the two-per-row grid holds, so the wrap is exercised.
 *
 * Three variants, each answering a question the default cannot:
 *   `--long`  30 lines — pagination: repeated table headers, the totals block staying whole, page
 *             numbers.
 *   `--free`  The REAL letterhead (two banks) with the delivery fee at zero, no discount and no
 *             deposit. It checks the derived free-delivery condition and the "Gratis" value, and it
 *             is the one to watch for the ONE-PAGE target: an ordinary order with the letterhead
 *             this business actually has must not spill onto a second sheet.
 *   `--quote` The cotización — the same model with a different `kind`: no order number, a validity
 *             date, and the "sujeta a cambios" notice. Those three differences are otherwise only
 *             visible through a running app and a half-filled form.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToBuffer } from '@react-pdf/renderer';
import OrderDocument from '../src/modules/panel/documents/OrderDocument';
import type { DocumentCopy } from '../src/modules/panel/documents/OrderDocument';
import type { DocumentLine, DocumentModel } from '../src/modules/panel/documents/documentModel';

const long = process.argv.includes('--long');
const free = process.argv.includes('--free');
const quote = process.argv.includes('--quote');
/**
 * `--rows=N` — the rental group's line count, overriding the variant's own.
 *
 * Pagination bugs live in a WINDOW, not at a value: an orphaned group title, a clipped repeating
 * header and a stranded divider each appear only when a break lands within a few points of the
 * wrong place, so "it looks fine" on one fixture proves nothing. Sweeping N walks the break through
 * every position in the page and makes those windows reproducible on demand (`--rows=10` is the
 * count that produced the reported artifact). It is why the keep-together rules could be verified
 * instead of assumed.
 */
const rowsArgument = process.argv.find((argument) => argument.startsWith('--rows='));
const rowCount = rowsArgument === undefined ? undefined : Number(rowsArgument.slice('--rows='.length));

const rentalLines: DocumentLine[] = rowCount !== undefined
  ? Array.from({ length: rowCount }, (_, index) => ({
      description: `Producto de relleno ${index + 1}`,
      quantity: 1,
      unitPrice: 10,
      days: 3,
      total: 30,
    }))
  : long
  ? Array.from({ length: 30 }, (_, index) => ({
      description: `Producto de prueba número ${index + 1} con un nombre deliberadamente largo`,
      quantity: index + 1,
      unitPrice: 10 + index,
      days: 3,
      total: (10 + index) * (index + 1) * 3,
    }))
  : [
      { description: 'Sillas plásticas blancas', quantity: 120, unitPrice: 2, days: 3, total: 720 },
      { description: 'Mesas rectangulares de 8 personas', quantity: 12, unitPrice: 25, days: 3, total: 900 },
      {
        description: 'Mantelería de lino con cubremantel a juego, incluye planchado y entrega',
        quantity: 12,
        unitPrice: 18,
        days: 3,
        total: 648,
      },
    ];

const rentalSubtotal = rentalLines.reduce((sum, line) => sum + line.total, 0);
const saleLines: DocumentLine[] = [
  { description: 'Piñata temática', quantity: 2, unitPrice: 85, total: 170 },
  { description: 'Bolsas de dulces surtidos', quantity: 40, unitPrice: 12, total: 480 },
];
const saleSubtotal = saleLines.reduce((sum, line) => sum + line.total, 0);

const deliveryFee = free ? 0 : 75;
const discount = free ? undefined : 100;
const deposit = free ? undefined : 500;
const total = rentalSubtotal + saleSubtotal + deliveryFee - (discount ?? 0);

const banks = [
  {
    name: 'Banrural',
    bankKey: 'banrural',
    accountType: 'Monetaria',
    accountNumber: '3135073193',
    holder: 'Aníbal Roberto Marroquín Sánchez',
  },
  {
    name: 'BAC Credomatic',
    bankKey: 'bac',
    accountType: 'Ahorro',
    accountNumber: '972762173',
    holder: 'Aníbal Roberto Marroquín Sánchez',
  },
  // The third exists only to push the two-per-row grid onto a second line, and to exercise the
  // logo-less fallback. `--free` drops it: that variant models the letterhead the business has.
  {
    name: 'Banco Industrial',
    bankKey: null,
    accountType: 'Monetaria',
    accountNumber: '0451234567',
    holder: 'Party Rentals GT, S.A.',
  },
].slice(0, free ? 2 : 3);

const ISSUED_AT = new Date('2026-08-06T15:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const model: DocumentModel = {
  // A cotización is the SAME model with a different `kind`: no order id to print, a validity date,
  // and the "sujeta a cambios" notice the template adds for a quote. Checking it here is the only
  // way to see those three differences without a running app and a half-filled form.
  kind: quote ? 'quote' : 'receipt',
  ...(quote ? { validUntil: new Date(ISSUED_AT.getTime() + 7 * DAY_MS) } : { reference: 8 }),
  issuedAt: ISSUED_AT,
  isPaid: false,
  letterhead: {
    businessName: 'Party Rentals GT',
    businessPhone: '5555-1234',
    hasTerms: true,
    conditions: [
      'Cualquier daño ocasionado en el mobiliario se cobrará.',
      'Precios y disponibilidad sujetos a cambios.',
    ],
    // Printed only when the delivery fee is 0, which is what `--free` sets — the default run must
    // NOT show it, and that absence is as much the thing to check as its presence.
    freeDeliveryNote: 'Domicilio gratis en Hacienda Real.',
    quoteValidityDays: 7,
    banks,
  },
  client: {
    name: 'María Fernanda Rodríguez de León',
    contact: '4123-9876',
    address: 'Salón del club, entrada norte, Hacienda Real, zona 16',
  },
  event: {
    type: 'Boda',
    deliveryAt: new Date('2026-08-14T14:00:00Z'),
    pickupAt: new Date('2026-08-16T22:00:00Z'),
    billedDays: 3,
  },
  groups: [
    { kind: 'rental', lines: rentalLines, subtotal: rentalSubtotal },
    { kind: 'sale', lines: saleLines, subtotal: saleSubtotal },
  ],
  totals: {
    groups: [
      { kind: 'rental', subtotal: rentalSubtotal },
      { kind: 'sale', subtotal: saleSubtotal },
    ],
    delivery: deliveryFee,
    ...(discount !== undefined && { discount }),
    total,
    ...(deposit !== undefined && { deposit }),
    balance: total - (deposit ?? 0),
  },
  currencySymbol: 'Q',
};

const MONEY = new Intl.NumberFormat('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('es-GT', {
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
});

// Mirrors `modules.panel.documents.*` in `es.json`. It is a hand copy on purpose: the script runs
// outside React and outside i18next, and pulling the whole i18n stack in to read a dozen leaves
// would make the preview depend on more machinery than the thing it previews.
const copy: DocumentCopy = {
  // `useDocumentCopy(kind)` picks this in the app; the preview mirrors that one branch by hand.
  title: quote ? 'Cotización' : 'Comprobante de pedido',
  reference: 'No.',
  issuedAt: 'Emitido',
  validUntil: 'Válida hasta',
  paid: 'PAGADO',
  quoteNotice: 'Cotización sujeta a cambios y a la disponibilidad de los artículos en las fechas indicadas.',
  termsNotice:
    'La aceptación de este documento implica la conformidad con los términos y condiciones del servicio.',
  phonePrefix: 'Tel.',
  clientCard: 'Cliente',
  clientName: 'Nombre',
  contact: 'Teléfono',
  address: 'Dirección de entrega',
  eventCard: 'Evento y logística',
  eventType: 'Tipo de evento',
  delivery: 'Entrega',
  pickup: 'Recolección',
  billedDays: 'Días facturados',
  billedDaysValue: (days) => `${days} ${days === 1 ? 'día' : 'días'}`,
  billedDaysHint: 'El alquiler se cobra por día iniciado.',
  groupRental: 'Alquiler',
  groupSale: 'Venta',
  columnDescription: 'Descripción',
  columnQuantity: 'Cantidad',
  columnDays: 'Días',
  columnDailyPrice: 'Precio por día',
  columnUnitPrice: 'Precio unitario',
  columnLineTotal: 'Subtotal',
  subtotal: 'Subtotal',
  deliveryFee: 'Servicio a domicilio',
  deliveryIncludesReturn: 'Incluye entrega y recolección',
  deliveryIncludesOneWay: 'Incluye entrega',
  free: 'Gratis',
  discount: 'Descuento',
  total: 'TOTAL',
  deposit: 'Anticipo',
  balance: 'Saldo pendiente',
  conditions: 'Condiciones',
  banks: 'Datos para depósito',
  page: (pageNumber, totalPages) => `Página ${pageNumber} de ${totalPages}`,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const variant = rowCount !== undefined
  ? `-rows${rowCount}`
  : long
    ? '-long'
    : free
      ? '-free'
      : quote
        ? '-quote'
        : '';
const out = path.join(here, `preview${variant}.pdf`);

const buffer = await renderToBuffer(
  <OrderDocument
    model={model}
    copy={copy}
    money={(amount) => `${model.currencySymbol} ${MONEY.format(amount)}`}
    date={(value) => DATE.format(value)}
    dateTime={(value) => DATE_TIME.format(value)}
  />,
);
await mkdir(here, { recursive: true });
await writeFile(out, buffer);
process.stdout.write(`${out}\n`);
