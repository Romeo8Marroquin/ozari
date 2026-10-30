/**
 * `pnpm doc:preview` — renders the order document from FIXTURE data to `scripts/.out/preview*.pdf`.
 *
 * A LOCAL-ONLY design tool, never bundled and never deployed. It exists because the template is the
 * one part of this feature a test cannot judge: `OrderDocument` is coverage-excluded precisely
 * because jsdom cannot drive react-pdf's layout engine, so "does it look right" has no assertion —
 * only a pair of eyes. Before this script, every visual change was a guess that took a round trip
 * through the running app, a login and a real order to evaluate.
 *
 * The fixture deliberately includes the awkward cases rather than a tidy one: a long product name
 * that must wrap, both a rental and a sale group, a discount, an anticipo, and three bank accounts —
 * one more than the two-per-row grid holds, so the wrap is exercised.
 *
 * Variants, each answering a question the default cannot:
 *   `--long`  30 lines — pagination: repeated table headers, the totals block staying whole, page
 *             numbers.
 *   `--free`  The REAL letterhead (two banks) with the delivery fee at zero, no discount and no
 *             anticipo. It checks the derived free-delivery condition and the "Gratis" value, and it
 *             is the one to watch for the ONE-PAGE target: an ordinary order with the letterhead
 *             this business actually has must not spill onto a second sheet.
 *   `--quote` The cotización — the same model with a different `kind`: no order number, a validity
 *             date, and the "sujeta a cambios" notice.
 *   `--rows=N` the rental group's line count — walks the page break through the column.
 *   `--no-photos` every row without its product photo — the document exactly as it was before row
 *             photos (2026-10-29). By default the rows carry LOCAL images of awkward shapes (tall,
 *             wide, square) plus a row with none; `--free` puts a photo on EVERY line, since it is
 *             the one-page check and that is the worst case for it.
 *
 * The MONEY BOX is squared by the app's own `squareOrderBalance` (EPIC-2-DOCUMENTS §2b), fed by
 * these flags — so every outcome the rule can reach is one command away:
 *   `--deposit=held|refunded|damages|retention|uncovered` — the security deposit's story:
 *       `held`       not reviewed yet (a quote, or before the pickup);
 *       `refunded`   reviewed clean — the whole deposit comes back;
 *       `damages`    a retention plus two replacements, more than the deposit covers;
 *       `retention`  a retention only (`--retention=N` sets it; 150 by default);
 *       `uncovered`  a replacement on a line that carried NO deposit at all.
 *       (`pnpm doc:preview:deposit` / `:refunded` / `:damages` are the named shortcuts.)
 *   `--collection=pending|received|waived` — was the deposit received? Defaults: `pending` while
 *       held, `received` once reviewed. Only a RECEIVED deposit is money we have (owner, 2026-10-28):
 *       after the review, `pending` and `waived` ("no recibido") credit nothing, the damages are
 *       billed whole (the retention included), the report prints no "Depósito recibido" table, and
 *       the box says "Depósito no recibido" under its result. Works with `--damage-report` too.
 *   `--paid` / `--unpaid` — the order's payment. Default: unpaid while held, paid once reviewed.
 *   `--advance=N` — the anticipo (500 by default, none with `--free`).
 *   `--retention=N` — the retained amount.
 *   `--damages=N` N filler replacement charges instead of the fixture's two — walks the damages
 *       panel from one that fits beside the summary to one taller than a page.
 *   `--long-reason` the longest texts the API accepts (500 characters) as the retention's
 *       description and every replacement's note.
 *
 * The DAMAGE REPORT ("REPORTE DE DAÑOS", `pnpm doc:preview:damage-report`) renders instead of the
 * order document with `--damage-report`. It is always a reviewed order (paid and `received` unless
 * told otherwise) and takes the money flags above plus its own:
 *   `--covered`  one lost chair and the retention — well inside the deposit: a refund, NO banks.
 *   `--clean`    the review found nothing: the whole deposit is credited back.
 *   `--banks=3`  the awkward third (logo-less) account; by default the report prints the two this
 *                business actually has, since its one-page target is the ordinary case.
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToBuffer } from '@react-pdf/renderer';
import OrderDocument, { DamageReportDocument } from '../src/modules/panel/documents/OrderDocument';
import type {
  BalanceCopy,
  DamageReportCopy,
  DocumentChromeCopy,
  DocumentCopy,
} from '../src/modules/panel/documents/OrderDocument';
import type {
  DamageReportModel,
  DocumentDepositClaim,
  DocumentLine,
  DocumentModel,
} from '../src/modules/panel/documents/documentModel';
import { advanceRows } from '../src/modules/panel/documents/documentModel';
import { squareOrderBalance } from '../src/modules/panel/orders/orderBalance';
import type { OrderBalanceInput } from '../src/modules/panel/orders/orderBalance';
import type { OrderDepositCollectionStatus } from '../src/modules/panel/orders/order.types';
import { lineDisplayName } from '../src/modules/panel/products/productVariations';

const flag = (name: string): boolean => process.argv.includes(name);
const option = (name: string): string | undefined =>
  process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const numberOption = (name: string): number | undefined => {
  const raw = option(name);
  return raw === undefined ? undefined : Number(raw);
};

const long = flag('--long');
const free = flag('--free');
const quote = flag('--quote');
const damageReport = flag('--damage-report');
const covered = flag('--covered');
const clean = flag('--clean');
const longReason = flag('--long-reason');
const threeBanks = flag('--banks=3');
const rowCount = numberOption('--rows');
const damageCount = numberOption('--damages');
const depositState = option('--deposit');
const collectionOption = option('--collection');
const advanceOption = numberOption('--advance');
const retentionOption = numberOption('--retention');

/** The longest text the settlement API accepts (`SETTLEMENT_TEXT_MAX_LENGTH`). */
const LONGEST_TEXT = (
  'Se encontraron manchas persistentes y residuos de cera en varias piezas que no salieron con el lavado ' +
  'ordinario; se envió a limpieza especializada y dos manteles quedaron con decoloración ' +
  'permanente en el centro, visible a simple vista. El cliente fue informado al momento de ' +
  'recoger y se tomaron fotografías como evidencia de cada pieza. Se descuenta el costo de la ' +
  'limpieza especializada y del planchado adicional que requirieron las piezas recuperables, ' +
  'según las condiciones del servicio aceptadas al confirmar el pedido.'
).slice(0, 500);

const RETENTION_REASON = longReason
  ? LONGEST_TEXT
  : 'Daño físico en la mantelería: manchas persistentes tras el lavado ordinario; se descuenta la limpieza especializada.';

// ── The scenario: who paid what, and what the review found ─────────────────────────────────────

/** Has the pickup review been recorded? The report always is one; the comprobante from `--deposit`. */
const reviewed =
  damageReport ||
  depositState === 'refunded' ||
  depositState === 'damages' ||
  depositState === 'retention' ||
  depositState === 'uncovered';
/** Does the order carry a deposit at all? (`uncovered` = replacement values with no deposit.) */
const carriesDeposit = damageReport || (depositState !== undefined && depositState !== 'uncovered');
const collection: OrderDepositCollectionStatus | undefined = !carriesDeposit
  ? undefined
  : quote
    ? 'PENDING'
    : collectionOption === 'waived'
      ? 'WAIVED'
      : collectionOption === 'received'
        ? 'RECEIVED'
        : collectionOption === 'pending'
          ? 'PENDING'
          : reviewed
            ? 'RECEIVED'
            : 'PENDING';
/** Only a RECEIVED deposit is money in hand; any other status on a deposit-carrying order is not. */
const received = collection === 'RECEIVED';
const notReceived = collection !== undefined && !received;
// The realistic case AFTER the pickup is a long-paid order; before it, an open one.
const isPaid = !quote && (flag('--paid') || (reviewed && !flag('--unpaid')));

// 120 chairs × Q5 + 12 tables × Q25 — the per-unit deposits the default rental lines carry.
/** The fixture's VARIATION line (2026-10-29), named exactly as `fromOrderDetail` names it. */
const VARIATION_LINE_NAME = lineDisplayName({ productName: 'Mantel', variantLabel: 'Rojo · Redondo' });

const DEPOSIT_TOTAL = 900;
// A retention is charged up to the NOMINAL deposit, received or not (owner, 2026-10-28).
const RETAINED = clean ? 0 : (retentionOption ?? 150);

/** The fixture's two replacements, or N filler ones (`--damages=N`). */
const replacementClaims: Extract<DocumentDepositClaim, { kind: 'replacement' }>[] =
  damageCount !== undefined
    ? Array.from({ length: damageCount }, (_, index) => ({
        kind: 'replacement' as const,
        description: `Producto dañado número ${index + 1}`,
        quantity: 1,
        unitAmount: 50,
        amount: 50,
        ...((longReason || index % 3 === 0) && {
          note: longReason ? LONGEST_TEXT : 'Se devolvió con una pata rota.',
        }),
      }))
    : [
        {
          kind: 'replacement',
          description: 'Mantelería de lino con cubremantel a juego, incluye planchado y entrega',
          quantity: 2,
          unitAmount: 350,
          amount: 700,
          note: longReason ? LONGEST_TEXT : 'Quemaduras de cigarro en ambas piezas.',
        },
        // A replacement on the VARIATION line — named by product + variation, like its row.
        {
          kind: 'replacement',
          description: VARIATION_LINE_NAME,
          quantity: 4,
          unitAmount: 45,
          amount: 180,
          ...(longReason && { note: LONGEST_TEXT }),
        },
      ];
const COVERED_REPLACEMENT: Extract<DocumentDepositClaim, { kind: 'replacement' }> = {
  kind: 'replacement',
  description: 'Sillas plásticas blancas',
  quantity: 1,
  unitAmount: 45,
  amount: 45,
  note: 'No se devolvió.',
};

/** What the review charged, in the comprobante's shape. */
const claims: DocumentDepositClaim[] = damageReport
  ? [
      ...(RETAINED > 0 ? [{ kind: 'retention' as const, amount: RETAINED, reason: RETENTION_REASON }] : []),
      ...(clean || depositState === 'retention'
        ? []
        : covered && damageCount === undefined
          ? [COVERED_REPLACEMENT]
          : replacementClaims),
    ]
  : depositState === 'damages'
    ? [
        ...(RETAINED > 0 ? [{ kind: 'retention' as const, amount: RETAINED, reason: RETENTION_REASON }] : []),
        ...replacementClaims,
      ]
    : depositState === 'retention'
      ? [{ kind: 'retention' as const, amount: RETAINED, reason: RETENTION_REASON }]
      : depositState === 'uncovered'
        ? [COVERED_REPLACEMENT]
        : [];
const claimsTotal = claims.reduce((sum, claim) => sum + claim.amount, 0);
const retainedTotal = claims.reduce((sum, claim) => sum + (claim.kind === 'retention' ? claim.amount : 0), 0);

// ── The order itself ───────────────────────────────────────────────────────────────────────────

// ── The row photos ─────────────────────────────────────────────────────────────────────────────
// In the app every photo is fetched, decoded and re-encoded as a small `data:` URI before the
// template sees it (`documentImages.ts`); Node has no canvas, so the preview embeds LOCAL files as
// they are. Deliberately awkward shapes, so `contain` is visible: a TALL one, a WIDE one, a square
// one — and rows with NO photo (`photos.none`) to check the gutter keeps descriptions aligned.
// `--no-photos` renders every row without one (the document as it was before photos).
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const photo = (relative: string): string =>
  `data:image/png;base64,${readFileSync(path.join(appRoot, relative)).toString('base64')}`;
const noPhotos = flag('--no-photos');
const photos = {
  tall: photo('public/assets/media-image.png'),
  wide: photo('src/assets/banks/banrural.png'),
  square: photo('src/assets/pngs/party.png'),
  // The VARIATION line's own photo (2026-10-29) — a different picture from every other row, the way
  // a red tablecloth's value photo differs from the product's showcase.
  variation: photo('src/assets/maps/apple-maps.png'),
};
const withPhoto = <Line extends object>(line: Line, imageUrl: string | undefined): Line =>
  noPhotos || imageUrl === undefined ? line : { ...line, imageUrl };
/** The filler rows' photos: the three shapes in turn, and every fourth row without one. */
const fillerPhoto = (index: number): string | undefined =>
  index % 4 === 3 ? undefined : [photos.tall, photos.wide, photos.square][index % 4];

const rentalLines: DocumentLine[] = rowCount !== undefined
  ? Array.from({ length: rowCount }, (_, index) =>
      withPhoto(
        {
          description: `Producto de relleno ${index + 1}`,
          quantity: 1,
          unitPrice: 10,
          days: 3,
          total: 30,
        },
        fillerPhoto(index),
      ),
    )
  : long
  ? Array.from({ length: 30 }, (_, index) =>
      withPhoto(
        {
          description: `Producto de prueba número ${index + 1} con un nombre deliberadamente largo`,
          quantity: index + 1,
          unitPrice: 10 + index,
          days: 3,
          total: (10 + index) * (index + 1) * 3,
        },
        fillerPhoto(index),
      ),
    )
  : [
      withPhoto(
        { description: 'Sillas plásticas blancas', quantity: 120, unitPrice: 2, days: 3, total: 720 },
        photos.tall,
      ),
      // `--free` is the ordinary FIVE-line order (§2a #20), so there the variation line below takes
      // this one-line row's place instead of adding a sixth: same height, the same one-page check.
      ...(free
        ? []
        : [
            withPhoto(
              {
                description: 'Mesas rectangulares de 8 personas',
                quantity: 12,
                unitPrice: 25,
                days: 3,
                total: 900,
              },
              photos.wide,
            ),
          ]),
      withPhoto(
        {
          description: 'Mantelería de lino con cubremantel a juego, incluye planchado y entrega',
          quantity: 12,
          unitPrice: 18,
          days: 3,
          total: 648,
        },
        photos.square,
      ),
      // A product sold by VARIATION: the line prints product + variation, with the variation's photo.
      withPhoto(
        { description: VARIATION_LINE_NAME, quantity: 10, unitPrice: 15, days: 3, total: 450 },
        photos.variation,
      ),
    ];

const rentalSubtotal = rentalLines.reduce((sum, line) => sum + line.total, 0);
const saleLines: DocumentLine[] = [
  // The row WITHOUT a photo — except on `--free`, which is the one-page check and so carries the
  // WORST case: a photo on every line.
  withPhoto(
    { description: 'Piñata temática', quantity: 2, unitPrice: 85, total: 170 },
    free ? photos.square : undefined,
  ),
  withPhoto(
    { description: 'Bolsas de dulces surtidos', quantity: 40, unitPrice: 12, total: 480 },
    photos.wide,
  ),
];
const saleSubtotal = saleLines.reduce((sum, line) => sum + line.total, 0);

const deliveryFee = free ? 0 : 75;
const discount = free ? undefined : 100;
/** The ANTICIPO — `OrderDetail.depositAmount`, not the security deposit. */
const advance = advanceOption ?? (free ? undefined : 500);
const total = rentalSubtotal + saleSubtotal + deliveryFee - (discount ?? 0);

/** The order, as `orderBalanceInput` would build it from an `OrderDetail`. */
const balanceInput: OrderBalanceInput = {
  total,
  advance: advance ?? 0,
  paid: isPaid,
  ...(collection !== undefined && { deposit: { amount: DEPOSIT_TOTAL, status: collection } }),
  ...(reviewed && { claimsTotal }),
};
const balance = squareOrderBalance(balanceInput);
const paidRemainder = isPaid ? squareOrderBalance({ ...balanceInput, paid: false }).serviceDue : 0;

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
  kind: quote ? 'quote' : 'receipt',
  ...(quote ? { validUntil: new Date(ISSUED_AT.getTime() + 7 * DAY_MS) } : { reference: 8 }),
  issuedAt: ISSUED_AT,
  isPaid,
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
    ...advanceRows(advance, total),
    ...(paidRemainder > 0 && { paid: paidRemainder }),
    balance,
    ...(reviewed && notReceived && { depositNotReceived: true as const }),
  },
  ...(claims.length > 0 && {
    damages: {
      withDeposit: received || retainedTotal > 0,
      depositNotReceived: notReceived,
      claims,
      total: claimsTotal,
    },
  }),
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
const balanceCopy: BalanceCopy = {
  depositDue: 'Depósito (reembolsable)',
  depositDueNote: 'Se devuelve al recoger, previa revisión.',
  claims: 'Daños',
  claimsNote: 'Detalle a continuación.',
  depositCredit: 'Depósito recibido',
  serviceDue: 'Saldo del servicio',
  advanceCredit: 'Saldo a favor del cliente',
  collect: 'Monto a pagar',
  refund: 'Monto a devolver al cliente',
  none: 'Sin saldo pendiente',
  depositOnHand: 'Depósito recibido',
  depositOnHandNote: 'Se devuelve al recoger, previa revisión.',
  depositNotReceived: 'Depósito no recibido: los daños se cobran completos.',
};
const RETENTION_NOT_RECEIVED = 'El depósito no se recibió: este monto se cobra aparte.';

const chrome: Omit<DocumentChromeCopy, 'title'> = {
  reference: 'No.',
  issuedAt: 'Emitido',
  phonePrefix: 'Tel.',
  clientCard: 'Cliente',
  clientName: 'Nombre',
  contact: 'Teléfono',
  address: 'Dirección de entrega',
  eventCard: 'Evento y logística',
  eventType: 'Tipo de evento',
  delivery: 'Entrega',
  pickup: 'Recolección',
  columnQuantity: 'Cantidad',
  columnLineTotal: 'Subtotal',
  banks: 'Datos para depósito',
  page: (pageNumber, totalPages) => `Página ${pageNumber} de ${totalPages}`,
  balance: balanceCopy,
};

const copy: DocumentCopy = {
  ...chrome,
  // `useDocumentCopy(kind)` picks this in the app; the preview mirrors that one branch by hand.
  title: quote ? 'Cotización' : 'Comprobante de pedido',
  validUntil: 'Válida hasta',
  paid: 'PAGADO',
  quoteNotice: 'Cotización sujeta a cambios y a la disponibilidad de los artículos en las fechas indicadas.',
  termsNotice:
    'La aceptación de este documento implica la conformidad con los términos y condiciones del servicio.',
  billedDays: 'Días facturados',
  billedDaysValue: (days) => `${days} ${days === 1 ? 'día' : 'días'}`,
  billedDaysHint: 'El alquiler se cobra por día iniciado.',
  groupRental: 'Alquiler',
  groupSale: 'Venta',
  columnDescription: 'Descripción',
  columnDays: 'Días',
  columnDailyPrice: 'Precio por día',
  columnUnitPrice: 'Precio unitario',
  subtotal: 'Subtotal',
  deliveryFee: 'Servicio a domicilio',
  deliveryIncludesReturn: 'Incluye entrega y recolección',
  deliveryIncludesOneWay: 'Incluye entrega',
  free: 'Gratis',
  discount: 'Descuento',
  total: 'TOTAL',
  advance: 'Anticipo',
  advanceReceived: (amount) => `Aplicado de un anticipo de ${amount}.`,
  paidAmount: 'Pagado',
  settlementTitle: 'Depósito y daños',
  damagesTitle: 'Daños',
  settlementRetention: 'Retención del depósito',
  settlementRetentionNotReceived: RETENTION_NOT_RECEIVED,
  settlementReplacement: (product) => `Reposición: ${product}`,
  settlementReplacementDetail: (quantity, unitAmount) => `${quantity} × ${unitAmount} c/u`,
  settlementClaimsTotal: 'Total por daños',
  conditions: 'Condiciones',
};

// ── The damage report fixture (`--damage-report`) ─────────────────────────────────────────────
// The SAME order as the comprobante fixture: its client, its event, its letterhead, its money and
// the deposit its two default rental lines carry (120 chairs × Q5 + 12 tables × Q25 = Q900).

const reportCopy: DamageReportCopy = {
  ...chrome,
  title: 'Reporte de daños',
  depositTitle: 'Depósito recibido',
  columnProduct: 'Producto',
  columnDepositEach: 'Depósito c/u',
  retentionTitle: 'Retención del depósito',
  retentionNoReason: 'Daño parcial sin descripción registrada.',
  retentionNotReceived: RETENTION_NOT_RECEIVED,
  replacementsTitle: 'Piezas perdidas o rotas',
  columnUnits: 'Unidades',
  columnReplacementEach: 'Reposición c/u',
  noClaims: 'La revisión al recoger no encontró daños: no hay cargos contra el depósito.',
  noClaimsNoDeposit: 'La revisión al recoger no encontró daños.',
  claimsTotal: 'Total por daños',
  claimsBreakdown: (retained, damages) => `Retención ${retained} + piezas ${damages}`,
  payTitle: 'Cómo pagar el saldo',
  payLead: 'Al depositar, indica el número de pedido.',
};

/** The damaged line's photo, as `fromDamageReport` finds it by line id: the fixture's own products
 *  by name, the fillers in turn. */
const replacementPhoto = (description: string, index: number): string | undefined =>
  description.startsWith('Mantelería')
    ? photos.square
    : description === VARIATION_LINE_NAME
      ? photos.variation
      : description.startsWith('Sillas')
        ? photos.tall
        : fillerPhoto(index);

const reportReplacements = claims
  .filter((claim) => claim.kind === 'replacement')
  .map((claim, index) =>
    withPhoto(
      {
        description: claim.description,
        quantity: claim.quantity,
        unitAmount: claim.unitAmount,
        amount: claim.amount,
        ...(claim.note !== undefined && { note: claim.note }),
      },
      replacementPhoto(claim.description, index),
    ),
  );

const reportModel: DamageReportModel = {
  // The letterhead this business ACTUALLY has — two accounts — because the report's one-page
  // target is about the ordinary case (`--banks=3` restores the awkward third, logo-less one).
  letterhead: { ...model.letterhead, banks: model.letterhead.banks.slice(0, threeBanks ? 3 : 2) },
  reference: 8,
  issuedAt: ISSUED_AT,
  client: model.client,
  event: {
    type: model.event.type,
    deliveryAt: model.event.deliveryAt,
    ...(model.event.pickupAt !== undefined && { pickupAt: model.event.pickupAt }),
  },
  // Only a RECEIVED deposit is printed as received: otherwise no table, no credit.
  deposit: received
    ? {
        total: DEPOSIT_TOTAL,
        lines: [
          withPhoto(
            { description: 'Sillas plásticas blancas', quantity: 120, unitAmount: 5, total: 600 },
            photos.tall,
          ),
          withPhoto(
            { description: 'Mesas rectangulares de 8 personas', quantity: 12, unitAmount: 25, total: 300 },
            photos.wide,
          ),
        ],
      }
    : { total: 0, lines: [] },
  depositNotReceived: notReceived,
  ...(retainedTotal > 0 && { retention: { amount: retainedTotal, reason: RETENTION_REASON } }),
  replacements: reportReplacements,
  totals: {
    retained: retainedTotal,
    damages: claimsTotal - retainedTotal,
    claims: claimsTotal,
  },
  balance,
  currencySymbol: 'Q',
};

const here = path.dirname(fileURLToPath(import.meta.url));
// Every flag that changes the render lands in the file name, so a sweep never overwrites itself.
const variant = [
  damageReport ? '-damage-report' : '',
  rowCount !== undefined ? `-rows${rowCount}` : long ? '-long' : free ? '-free' : quote ? '-quote' : '',
  covered ? '-covered' : '',
  clean ? '-clean' : '',
  threeBanks ? '-banks3' : '',
  depositState === undefined ? '' : `-deposit-${depositState}`,
  collectionOption === undefined ? '' : `-${collectionOption}`,
  flag('--paid') ? '-paid' : '',
  flag('--unpaid') ? '-unpaid' : '',
  advanceOption === undefined ? '' : `-advance${advanceOption}`,
  retentionOption === undefined ? '' : `-retention${retentionOption}`,
  damageCount === undefined ? '' : `-damages${damageCount}`,
  longReason ? '-long-reason' : '',
  noPhotos ? '-no-photos' : '',
].join('');
const out = path.join(here, `preview${variant}.pdf`);

const money = (amount: number): string => `Q ${MONEY.format(amount)}`;
const date = (value: Date): string => DATE.format(value);
const dateTime = (value: Date): string => DATE_TIME.format(value);
const buffer = await renderToBuffer(
  damageReport ? (
    <DamageReportDocument
      model={reportModel}
      copy={reportCopy}
      money={money}
      date={date}
      dateTime={dateTime}
    />
  ) : (
    <OrderDocument model={model} copy={copy} money={money} date={date} dateTime={dateTime} />
  ),
);
await mkdir(here, { recursive: true });
await writeFile(out, buffer);
process.stdout.write(
  `${out}\n` +
    `  squared: ${balance.direction} ${money(balance.amount)}` +
    ` (service ${money(balance.serviceDue)}, saldo a favor ${money(balance.advanceCredit)},` +
    ` deposit due ${money(balance.depositDue)},` +
    ` on hand ${money(balance.depositOnHand)}, claims ${money(balance.claims)},` +
    ` credit ${money(balance.depositCredit)})\n`,
);
