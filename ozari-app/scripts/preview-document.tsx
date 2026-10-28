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
 *   `--deposit=held|refunded|damages|uncovered` — the security deposit ("Depósito") in each state
 *             `documentModel` decides; composes with the rest (see `depositState` below).
 *             `pnpm doc:preview:deposit` / `:refunded` / `:damages` are the three named shortcuts.
 *   `--damages=N` N filler replacement charges instead of the fixture's two — walks the
 *             "DEPÓSITO Y DAÑOS" panel from one that fits beside the summary to one taller than a
 *             page (the oversized arrangement). Composes with `--deposit=damages` and with
 *             `--damage-report`.
 *   `--long-reason` the longest texts the API accepts (500 characters) as the retention's
 *             description and every replacement's note.
 *
 * The DAMAGE REPORT ("REPORTE DE DAÑOS", `pnpm doc:preview:damage-report`) renders instead of the
 * order document with `--damage-report`, and takes its own flags:
 *   `--draft`    built from unsaved form values: the BORRADOR mark, no settlement date.
 *   `--covered`  the deposit covers everything: a refund, no balance due, so NO bank accounts.
 *   `--banks=3`  the awkward third (logo-less) account; by default the report prints the two this
 *                business actually has, since its one-page target is the ordinary case.
 *   (plus `--damages=N` and `--long-reason` above).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToBuffer } from '@react-pdf/renderer';
import OrderDocument, { DamageReportDocument } from '../src/modules/panel/documents/OrderDocument';
import type {
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

const long = process.argv.includes('--long');
const free = process.argv.includes('--free');
const quote = process.argv.includes('--quote');
const damageReport = process.argv.includes('--damage-report');
const draft = process.argv.includes('--draft');
const covered = process.argv.includes('--covered');
const longReason = process.argv.includes('--long-reason');
/**
 * `--deposit=STATE` — the security deposit in each of the states `documentModel` can decide.
 * Composes with every other flag (`--quote --deposit=held`, `--rows=N --deposit=damages`), because
 * the deposit's height is what moves the page break.
 *   `held`       collected on top of the order, refundable — a quote, or an unsettled comprobante.
 *   `refunded`   the happy path: settled with nothing claimed. Still a deposit, never a cost.
 *   `damages`    a retention with a long reason plus two replacements (one with a wrapping product
 *                name) — more than the deposit covers, so a balance is still owed. Paid order, so
 *                the PAGADO mark and a zero order saldo sit beside a non-zero damages balance.
 *   `uncovered`  replacements on lines that carried NO deposit — no "covered"/"returned" lines.
 */
const depositArgument = process.argv.find((argument) => argument.startsWith('--deposit='));
const depositState = depositArgument?.slice('--deposit='.length);
const damagesArgument = process.argv.find((argument) => argument.startsWith('--damages='));
const damageCount =
  damagesArgument === undefined ? undefined : Number(damagesArgument.slice('--damages='.length));

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
        {
          kind: 'replacement',
          description: 'Sillas plásticas blancas',
          quantity: 4,
          unitAmount: 45,
          amount: 180,
          ...(longReason && { note: LONGEST_TEXT }),
        },
      ];
const replacementsTotal = replacementClaims.reduce((sum, claim) => sum + claim.amount, 0);
const RETAINED = 150;
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

// 120 chairs × Q5 + 12 tables × Q25 — the per-unit deposits the default rental lines would carry.
const DEPOSIT_TOTAL = 900;
const securityDeposit: DocumentModel['securityDeposit'] =
  depositState === 'held'
    ? { status: 'held', amount: DEPOSIT_TOTAL }
    : depositState === 'refunded'
      ? { status: 'refunded', amount: DEPOSIT_TOTAL, refund: DEPOSIT_TOTAL }
      : depositState === 'damages'
        ? {
            status: 'settled',
            amount: DEPOSIT_TOTAL,
            claims: [
              { kind: 'retention', amount: RETAINED, reason: RETENTION_REASON },
              ...replacementClaims,
            ],
            claimsTotal: RETAINED + replacementsTotal,
            applied: Math.min(DEPOSIT_TOTAL, RETAINED + replacementsTotal),
            refund: Math.max(0, DEPOSIT_TOTAL - RETAINED - replacementsTotal),
            balanceDue: Math.max(0, RETAINED + replacementsTotal - DEPOSIT_TOTAL),
          }
        : depositState === 'uncovered'
          ? {
              status: 'settled',
              amount: 0,
              claims: [
                {
                  kind: 'replacement',
                  description: 'Sillas plásticas blancas',
                  quantity: 1,
                  unitAmount: 45,
                  amount: 45,
                  note: 'No se devolvió.',
                },
              ],
              claimsTotal: 45,
              applied: 0,
              refund: 0,
              balanceDue: 45,
            }
          : undefined;
// The damages case is the realistic one AFTER the pickup: the order itself is long paid, and what
// is still owed is the damage — two different saldos that must not read as one.
const isPaid = depositState === 'damages';

const model: DocumentModel = {
  // A cotización is the SAME model with a different `kind`: no order id to print, a validity date,
  // and the "sujeta a cambios" notice the template adds for a quote. Checking it here is the only
  // way to see those three differences without a running app and a half-filled form.
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
    ...(deposit !== undefined && { deposit }),
    balance: isPaid ? 0 : total - (deposit ?? 0),
  },
  ...(securityDeposit !== undefined && { securityDeposit }),
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
  deposit: 'Anticipo',
  balance: 'Saldo pendiente',
  depositHeld: 'Depósito (reembolsable)',
  depositHeldNote: 'Aparte del total; se devuelve al recoger, previa revisión.',
  depositRefunded: 'Depósito (devuelto)',
  depositRefundedNote: 'Revisión sin cargos: se devolvió completo.',
  settlementTitle: 'Depósito y daños',
  settlementRetention: 'Retención del depósito',
  settlementReplacement: (product) => `Reposición: ${product}`,
  settlementReplacementDetail: (quantity, unitAmount) => `${quantity} × ${unitAmount} c/u`,
  settlementClaimsTotal: 'Total por daños',
  settlementApplied: 'Cubierto con el depósito',
  settlementBalanceDue: 'Saldo pendiente por daños',
  settlementRefund: 'Depósito devuelto',
  settlementRefundNote: (amount) => `De un depósito de ${amount}`,
  conditions: 'Condiciones',
};

// ── The damage report fixture (`--damage-report`) ─────────────────────────────────────────────
// The SAME order as the comprobante fixture: its client, its event, its letterhead, and the deposit
// its two default rental lines carry (120 chairs × Q5 + 12 tables × Q25 = Q900).

const reportCopy: DamageReportCopy = {
  ...chrome,
  title: 'Reporte de daños',
  draftMark: 'Borrador — sujeto a revisión',
  settledAt: 'Revisado',
  depositTitle: 'Depósito recibido',
  columnProduct: 'Producto',
  columnDepositEach: 'Depósito c/u',
  retentionTitle: 'Retención del depósito',
  retentionNoReason: 'Daño parcial sin descripción registrada.',
  replacementsTitle: 'Piezas perdidas o rotas',
  columnUnits: 'Unidades',
  columnReplacementEach: 'Reposición c/u',
  noClaims: 'La revisión al recoger no encontró daños: el depósito se devuelve completo.',
  claimsTotal: 'Total por daños',
  claimsBreakdown: (retained, damages) => `Retención ${retained} + piezas ${damages}`,
  refundNote: (amount) => `De un depósito de ${amount}`,
  applied: 'Cubierto con el depósito',
  refund: 'Se devuelve al cliente',
  balanceDue: 'Saldo por cobrar al cliente',
  payTitle: 'Cómo pagar el saldo',
  payLead: 'Al depositar, indica el número de pedido.',
};

// `--covered`: one lost chair and a small retention — well inside the deposit, so nothing is owed.
const reportReplacements =
  covered && damageCount === undefined
    ? [
        {
          description: 'Sillas plásticas blancas',
          quantity: 1,
          unitAmount: 45,
          amount: 45,
          note: 'No se devolvió.',
        },
      ]
    : replacementClaims.map((claim) => ({
        description: claim.description,
        quantity: claim.quantity,
        unitAmount: claim.unitAmount,
        amount: claim.amount,
        ...(claim.note !== undefined && { note: claim.note }),
      }));
const reportDamages = reportReplacements.reduce((sum, item) => sum + item.amount, 0);
const reportClaims = RETAINED + reportDamages;

const reportModel: DamageReportModel = {
  // The letterhead this business ACTUALLY has — two accounts — because the report's one-page
  // target is about the ordinary case (`--banks=3` restores the awkward third, logo-less one).
  letterhead: {
    ...model.letterhead,
    banks: model.letterhead.banks.slice(0, process.argv.includes('--banks=3') ? 3 : 2),
  },
  reference: 8,
  issuedAt: ISSUED_AT,
  draft,
  ...(!draft && { settledAt: new Date('2026-08-17T16:00:00Z') }),
  client: model.client,
  event: {
    type: model.event.type,
    deliveryAt: model.event.deliveryAt,
    ...(model.event.pickupAt !== undefined && { pickupAt: model.event.pickupAt }),
  },
  deposit: {
    total: DEPOSIT_TOTAL,
    lines: [
      { description: 'Sillas plásticas blancas', quantity: 120, unitAmount: 5, total: 600 },
      { description: 'Mesas rectangulares de 8 personas', quantity: 12, unitAmount: 25, total: 300 },
    ],
  },
  retention: { amount: RETAINED, reason: RETENTION_REASON },
  replacements: reportReplacements,
  totals: {
    retained: RETAINED,
    damages: reportDamages,
    claims: reportClaims,
    applied: Math.min(DEPOSIT_TOTAL, reportClaims),
    refund: Math.max(0, DEPOSIT_TOTAL - reportClaims),
    balanceDue: Math.max(0, reportClaims - DEPOSIT_TOTAL),
  },
  currencySymbol: 'Q',
};

const here = path.dirname(fileURLToPath(import.meta.url));
const variant = damageReport
  ? '-damage-report' +
    (draft ? '-draft' : '') +
    (covered ? '-covered' : '') +
    (process.argv.includes('--banks=3') ? '-banks3' : '') +
    (damageCount === undefined ? '' : `-damages${damageCount}`) +
    (longReason ? '-long-reason' : '')
  : (rowCount !== undefined
      ? `-rows${rowCount}`
      : long
        ? '-long'
        : free
          ? '-free'
          : quote
            ? '-quote'
            : '') +
    // Composes with the rest, so `--quote --deposit=held` and `--rows=N --deposit=damages` each
    // land in their own file instead of overwriting the base variant's.
    (depositState === undefined ? '' : `-deposit-${depositState}`) +
    (damageCount === undefined ? '' : `-damages${damageCount}`) +
    (longReason ? '-long-reason' : '');
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
process.stdout.write(`${out}\n`);
