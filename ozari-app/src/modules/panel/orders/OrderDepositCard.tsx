import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowUturnLeft,
  HiOutlineBanknotes,
  HiOutlineCheckCircle,
  HiOutlineNoSymbol,
  HiOutlineExclamationTriangle,
  HiOutlinePencilSquare,
} from 'react-icons/hi2';
import Button from '@components/Button';
import MorphSwap from '@components/MorphSwap';
import ActionRow from '../ActionRow';
import DamageReportButton from '../documents/DamageReportButton';
import useMorphOnChange from '../useMorphOnChange';
import { formatMoment } from './orderDayGroups';
import { formatMoney } from './orderEstimate';
import type { DepositCollectionMode } from './OrderDepositCollectionModal';
import type { OrderDetail, OrderSecurityDeposit } from './order.types';

const KEY = 'modules.panel.orders.detail.deposit';
const SECONDARY_COLOR = '#262626';

/** One money line of the breakdown: a label that may wrap (a product name is user text) beside an
 *  amount that never does. `sub` is the line's own explanation (a reason, a note) underneath. */
const MoneyLine: React.FC<{
  label: string;
  amount: string;
  sub?: string;
  className?: string;
}> = ({ label, amount, sub, className = 'text-charcoal/70' }) => (
  <div className={`flex flex-col gap-0.5 ${className}`}>
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 tabular-nums">{amount}</span>
    </div>
    {sub && <p className="break-words text-xs text-charcoal/50">{sub}</p>}
  </div>
);

/**
 * The order detail's "Depósito" card — the refundable security deposit and, once the goods are back,
 * what was recorded about it. ("Depósito" is the owner's word with clients; the app never says
 * "garantía" or "liquidar".) Rendered only when the API sent the block (an order that can carry a
 * deposit or a damage). The states, all decided by the API's flags:
 *
 * - not recorded, not recordable yet → the total and "después de la entrega…";
 * - not recorded, recordable (Admin) → the HAPPY PATH first: "Devolver depósito" when a deposit is
 *   IN HAND, else "Registrar sin daños" (no deposit on the order, or one not received — nothing to
 *   give back), a one-tap confirm owned by the page; then the DAMAGE PATH, "Reportar daños" → the
 *   dedicated page;
 * - recorded → the API's OWN breakdown, a chip that says how it ended ("Devuelto" when nothing was
 *   claimed from a deposit in hand, "Sin daños" with none in hand, "Con daños" otherwise — branched
 *   on the API's `claimsTotal`/`held`, never recomputed), the damage report download when something
 *   was claimed, "Reportar daños"/"Editar reporte de daños" (while recordable) and "Deshacer".
 *
 * **"Cobro del depósito"** (when the API sent `collection` — a deposit > 0): was the deposit actually
 * RECEIVED? Only a received deposit is money we have (owner, 2026-10-28): the API's `held` is 0
 * otherwise, and `held` — never a recomputation — decides between "Devolver depósito" and "Registrar
 * sin daños". In plain words: "Pendiente", "Recibido el …", or "No recibido: <reason>" (an INTERNAL
 * note — e.g. a relative; it may still arrive). While `canRecord` (any time but a cancelled order,
 * AFTER a damage report too) a deposit not received offers "Registrar depósito recibido", PENDING
 * also "Marcar como no recibido", and a recorded answer "Corregir" (back to pending). After a report
 * with the deposit not received the row says what that means — the damages billed whole, nothing to
 * give back — since recording it recomputes the outcome.
 *
 * **Every figure is the API's** (`held`, the settlement's numbers). The refund and the balance are
 * rendered, never re-derived here — the "Reportar daños" page may preview them, but this card is
 * the record.
 *
 * The body is a morph region keyed on the settlement's identity, so an undo or a quick refund eases
 * the card between states instead of swapping it in one frame; the buttons are an `ActionRow` for
 * the same reason. `ref` (React 19: a plain prop) is the section, so the page header's "Depósito
 * pendiente" can bring the card into view and land focus on its first action.
 */
const OrderDepositCard: React.FC<{
  order: OrderDetail;
  deposit: OrderSecurityDeposit;
  isAdmin: boolean;
  /** Opens the confirm that records a clean return (nothing claimed). */
  onRefund: () => void;
  /** Opens the "Reportar daños" page (record, or correct the recorded report). */
  onReport: () => void;
  /** Opens the undo confirmation. */
  onUndo: () => void;
  /** Opens a "Cobro del depósito" dialog: received, without deposit, or "Corregir". */
  onCollection: (mode: DepositCollectionMode) => void;
  ref?: React.Ref<HTMLElement>;
}> = ({ order, deposit, isAdmin, onRefund, onReport, onUndo, onCollection, ref }) => {
  const { t } = useTranslation();
  const money = (value: number): string => formatMoney(order.currency.symbol, value);
  const { settlement, canSettle, collection } = deposit;
  // The deposit IN HAND — the API's `held`: 0 unless it was actually RECEIVED (owner, 2026-10-28).
  // Only this can be refunded or applied against damages.
  const inHand = deposit.held > 0;
  // The order carries a deposit nobody has recorded as received (PENDING or WAIVED; a legacy order
  // without a collection reads PENDING): the damages are then billed whole, nothing comes back.
  const notReceived = deposit.total > 0 && collection?.status !== 'RECEIVED';
  const claimed = settlement !== undefined && settlement.claimsTotal > 0;
  const body = useMorphOnChange<HTMLDivElement>(
    `${settlement?.settledAt ?? ''}|${settlement?.claimsTotal ?? ''}|${canSettle}|${collection?.status ?? ''}|${deposit.held}`,
  );

  const chip = settlement
    ? claimed
      ? { label: t(`${KEY}.chipDamaged`), tone: 'bg-red-50 text-red-600' }
      : inHand
        ? { label: t(`${KEY}.chipRefunded`), tone: 'bg-emerald-50 text-emerald-600' }
        : { label: t(`${KEY}.chipNoDamage`), tone: 'bg-emerald-50 text-emerald-600' }
    : canSettle
      ? { label: t(`${KEY}.chipPending`), tone: 'bg-amber-50 text-amber-600' }
      : undefined;

  const actionItems = isAdmin
    ? [
        // The happy path leads: most deposits simply go back whole.
        ...(!settlement && canSettle
          ? [
              {
                key: 'refund',
                node: (
                  <Button
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineCheckCircle className="size-4" />}
                    onClick={onRefund}
                  >
                    {t(`${KEY}.${inHand ? 'refundAction' : 'noDamageAction'}`)}
                  </Button>
                ),
              },
            ]
          : []),
        // The damage path — the same key before and after recording, so the button adapts in place
        // ("Reportar daños" → "Editar reporte de daños") instead of being replaced.
        ...(canSettle
          ? [
              {
                key: 'report',
                node: (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={
                      claimed ? (
                        <HiOutlinePencilSquare className="size-4" />
                      ) : (
                        <HiOutlineExclamationTriangle className="size-4" />
                      )
                    }
                    onClick={onReport}
                  >
                    <MorphSwap swapKey={claimed ? 'edit' : 'report'}>
                      {t(`${KEY}.${claimed ? 'editReport' : 'report'}`)}
                    </MorphSwap>
                  </Button>
                ),
              },
            ]
          : []),
        // The client's copy of what was claimed — only when something was.
        ...(settlement && claimed
          ? [
              {
                key: 'damage-report',
                node: <DamageReportButton order={order} settlement={settlement} />,
              },
            ]
          : []),
        // Undo is always offered on a recorded settlement — even on an order that was cancelled or
        // rewound since, which is exactly when the record most needs clearing.
        ...(settlement
          ? [
              {
                key: 'undo',
                node: (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineArrowUturnLeft className="size-4" />}
                    onClick={onUndo}
                  >
                    {t(`${KEY}.undo`)}
                  </Button>
                ),
              },
            ]
          : []),
      ]
    : [];

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="order-deposit-title"
      className="reveal-item flex flex-col gap-4 rounded-card bg-white p-5 ring-1 ring-black/[0.04] outline-none focus-visible:ring-2 focus-visible:ring-charcoal/30"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="order-deposit-title" className="text-sm font-semibold text-charcoal">
          {t(`${KEY}.title`)}
        </h2>
        {chip && (
          <span
            className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-[background-color,color] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${chip.tone}`}
          >
            <MorphSwap swapKey={chip.label}>{chip.label}</MorphSwap>
          </span>
        )}
      </div>

      <div ref={body} className="flex flex-col gap-3 text-sm">
        {/* The deposit itself — collected ON TOP of the order, never part of its total. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0 grow basis-56">
            <p className="font-medium text-charcoal">{t(`${KEY}.total`)}</p>
            <p className="text-xs text-charcoal/50">{t(`${KEY}.totalNote`)}</p>
          </div>
          {/* The AGREED deposit — what the order asks for. Whether it arrived is the next row. */}
          <span className="shrink-0 font-semibold tabular-nums text-charcoal">
            {money(deposit.total)}
          </span>
        </div>

        {/* Was it actually received? The label/control row rule: the description carries the
            `basis-56` floor and the row wraps, so the actions fold under it on a narrow card.
            Recordable at ANY time the API allows (`canRecord` — after a damage report too): every
            amount recomputes from it. */}
        {collection && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/[0.06] pt-3">
            <div className="min-w-0 grow basis-56">
              <p className="font-medium text-charcoal">{t(`${KEY}.collection.title`)}</p>
              <p
                className={`break-words text-xs ${
                  collection.status === 'RECEIVED' ? 'text-charcoal/60' : 'text-amber-700'
                }`}
              >
                {collection.status === 'PENDING'
                  ? t(`${KEY}.collection.pending`)
                  : collection.status === 'RECEIVED'
                    ? collection.at
                      ? t(`${KEY}.collection.received`, { date: formatMoment(collection.at) })
                      : t(`${KEY}.collection.receivedNoDate`)
                    : t(`${KEY}.collection.waived`, { reason: collection.reason ?? '—' })}
              </p>
              {collection.status === 'WAIVED' && (
                <p className="text-xs text-charcoal/45">{t(`${KEY}.collection.internalNote`)}</p>
              )}
              {/* After the report, the consequence of a deposit not received — and the way out. */}
              {notReceived && settlement && (
                <p className="text-xs text-charcoal/55">{t(`${KEY}.collection.notReceivedAfterReport`)}</p>
              )}
            </div>
            {isAdmin && collection.canRecord && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Not received yet (pending, or recorded as not received — it may still arrive). */}
                {collection.status !== 'RECEIVED' && (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineBanknotes className="size-4" />}
                    onClick={() => onCollection('receive')}
                  >
                    {t(`${KEY}.collection.markReceived`)}
                  </Button>
                )}
                {collection.status === 'PENDING' ? (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineNoSymbol className="size-4" />}
                    onClick={() => onCollection('waive')}
                  >
                    {t(`${KEY}.collection.waive`)}
                  </Button>
                ) : (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineArrowUturnLeft className="size-4" />}
                    onClick={() => onCollection('clear')}
                  >
                    {t(`${KEY}.collection.correct`)}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {settlement ? (
          <div className="flex flex-col gap-2 border-t border-black/[0.06] pt-3">
            {!claimed && (
              <p className="text-charcoal/60">
                {t(
                  `${KEY}.${inHand ? 'noClaims' : notReceived ? 'noClaimsNotReceived' : 'noClaimsNoDeposit'}`,
                )}
              </p>
            )}
            {settlement.retainedAmount > 0 && (
              <MoneyLine
                label={t(`${KEY}.retained`)}
                amount={`−${money(settlement.retainedAmount)}`}
                sub={
                  settlement.retainedReason
                    ? t(`${KEY}.reason`, { reason: settlement.retainedReason })
                    : undefined
                }
              />
            )}
            {settlement.damages.map((damage) => (
              <MoneyLine
                key={damage.lineId}
                label={t(`${KEY}.damage`, {
                  product: damage.productName,
                  quantity: damage.quantity,
                  unit: money(damage.unitAmount),
                })}
                amount={`−${money(damage.amount)}`}
                sub={damage.note ? t(`${KEY}.note`, { note: damage.note }) : undefined}
              />
            ))}
            {/* Only a deposit in hand can come back — with none, a "Q0.00 back" line is noise. */}
            {inHand && (
              <MoneyLine
                label={t(`${KEY}.refund`)}
                amount={money(settlement.refundAmount)}
                className="border-t border-black/[0.06] pt-2 font-semibold text-charcoal"
              />
            )}
            {settlement.balanceDue > 0 && (
              <MoneyLine
                label={t(`${KEY}.balanceDue`)}
                amount={money(settlement.balanceDue)}
                sub={
                  inHand
                    ? t(`${KEY}.balanceDueNote`)
                    : notReceived
                      ? t(`${KEY}.balanceDueNotReceived`)
                      : undefined
                }
                className={`font-semibold text-red-600 ${
                  inHand ? '' : 'border-t border-black/[0.06] pt-2'
                }`}
              />
            )}
            <p className="text-xs text-charcoal/50">
              {t(`${KEY}.settledAt`)}: {formatMoment(settlement.settledAt)}
            </p>
          </div>
        ) : (
          <p className="text-charcoal/60">
            {t(
              `${KEY}.${canSettle ? (inHand ? 'due' : notReceived ? 'dueNotReceived' : 'dueNoDeposit') : 'notYet'}`,
            )}
          </p>
        )}

        <ActionRow items={actionItems} className="flex flex-wrap items-center gap-2" />
      </div>
    </section>
  );
};

export default OrderDepositCard;
