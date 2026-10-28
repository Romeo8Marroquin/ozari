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
 * - not recorded, recordable (Admin) → the HAPPY PATH first: "Devolver depósito" (or "Sin daños"
 *   when the order carries replacement values but no deposit), a one-tap confirm owned by the page;
 *   then the DAMAGE PATH, "Reportar daños" → the dedicated page;
 * - recorded → the API's OWN breakdown, a chip that says how it ended ("Devuelto" when nothing was
 *   claimed, "Con daños" otherwise — branched on the API's `claimsTotal`, never recomputed), the
 *   damage report download when something was claimed, "Reportar daños"/"Editar reporte de daños"
 *   (while recordable) and "Deshacer".
 *
 * **"Cobro del depósito"** (when the API sent `collection` — a deposit > 0): was the deposit actually
 * handed over? PENDING offers "Marcar como recibido" / "Entregar sin depósito"; RECEIVED shows when;
 * WAIVED shows the reason as an INTERNAL note; "Corregir" clears it while `canRecord`, and a recorded
 * damage report locks it (said in a hint). A WAIVED deposit makes `held` 0, and `held` — never a
 * recomputation — is what turns the quick action into "Sin daños".
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
  // The deposit the report counts — 0 when there is none, or when it was WAIVED (the API's figure).
  const hasDeposit = deposit.held > 0;
  const claimed = settlement !== undefined && settlement.claimsTotal > 0;
  const body = useMorphOnChange<HTMLDivElement>(
    `${settlement?.settledAt ?? ''}|${settlement?.claimsTotal ?? ''}|${canSettle}|${collection?.status ?? ''}`,
  );

  const chip = settlement
    ? claimed
      ? { label: t(`${KEY}.chipDamaged`), tone: 'bg-red-50 text-red-600' }
      : { label: t(`${KEY}.chipRefunded`), tone: 'bg-emerald-50 text-emerald-600' }
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
                    {t(`${KEY}.${hasDeposit ? 'refundAction' : 'noDamageAction'}`)}
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
          <span className="shrink-0 font-semibold tabular-nums text-charcoal">
            {money(deposit.held)}
          </span>
        </div>

        {/* Was it actually handed over? The label/control row rule: the description carries the
            `basis-56` floor and the row wraps, so the actions fold under it on a narrow card. */}
        {collection && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/[0.06] pt-3">
            <div className="min-w-0 grow basis-56">
              <p className="font-medium text-charcoal">{t(`${KEY}.collection.title`)}</p>
              <p
                className={`break-words text-xs ${
                  collection.status === 'PENDING' ? 'text-amber-700' : 'text-charcoal/60'
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
              {!collection.canRecord && settlement && (
                <p className="text-xs text-charcoal/45">{t(`${KEY}.collection.lockedByReport`)}</p>
              )}
            </div>
            {isAdmin && collection.canRecord && (
              <div className="flex flex-wrap items-center gap-2">
                {collection.status === 'PENDING' ? (
                  <>
                    <Button
                      variant="soft"
                      size="sm"
                      color={SECONDARY_COLOR}
                      startIcon={<HiOutlineBanknotes className="size-4" />}
                      onClick={() => onCollection('receive')}
                    >
                      {t(`${KEY}.collection.markReceived`)}
                    </Button>
                    <Button
                      variant="soft"
                      size="sm"
                      color={SECONDARY_COLOR}
                      startIcon={<HiOutlineNoSymbol className="size-4" />}
                      onClick={() => onCollection('waive')}
                    >
                      {t(`${KEY}.collection.waive`)}
                    </Button>
                  </>
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
                {t(`${KEY}.${hasDeposit ? 'noClaims' : 'noClaimsNoDeposit'}`)}
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
            <MoneyLine
              label={t(`${KEY}.refund`)}
              amount={money(settlement.refundAmount)}
              className="border-t border-black/[0.06] pt-2 font-semibold text-charcoal"
            />
            {settlement.balanceDue > 0 && (
              <MoneyLine
                label={t(`${KEY}.balanceDue`)}
                amount={money(settlement.balanceDue)}
                sub={t(`${KEY}.balanceDueNote`)}
                className="font-semibold text-red-600"
              />
            )}
            <p className="text-xs text-charcoal/50">
              {t(`${KEY}.settledAt`)}: {formatMoment(settlement.settledAt)}
            </p>
          </div>
        ) : (
          <p className="text-charcoal/60">
            {t(`${KEY}.${canSettle ? (hasDeposit ? 'due' : 'dueNoDeposit') : 'notYet'}`)}
          </p>
        )}

        <ActionRow items={actionItems} className="flex flex-wrap items-center gap-2" />
      </div>
    </section>
  );
};

export default OrderDepositCard;
