import { useTranslation } from 'react-i18next';
import { HiOutlineArrowUturnLeft, HiOutlinePencilSquare, HiOutlineShieldCheck } from 'react-icons/hi2';
import Button from '@components/Button';
import ActionRow from '../ActionRow';
import useMorphOnChange from '../useMorphOnChange';
import { formatMoment } from './orderDayGroups';
import { formatMoney } from './orderEstimate';
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
 * The order detail's "Garantía" card — the refundable security deposit and, once the goods are
 * back, how it was settled. Rendered only when the API sent the block (an order that can carry a
 * deposit or a damage). Three states, all decided by the API's flags:
 *
 * - not settled, not settleable yet → the total and "se liquida después de la entrega";
 * - not settled, settleable → the total and the primary "Liquidar garantía" (Admin);
 * - settled → the API's OWN breakdown (retained + reason, each lost/broken line, what goes back,
 *   what is still owed) with "Editar liquidación" (while settleable) and "Deshacer liquidación".
 *
 * **Every figure is the API's.** The refund and the balance are rendered, never re-derived here —
 * the settlement page may preview them, but this card is the record.
 *
 * The body is a morph region keyed on the settlement's identity, so an undo (the one transition that
 * happens on this page) eases the card from the breakdown to the "por liquidar" state instead of
 * swapping it in one frame; the buttons are an `ActionRow` for the same reason.
 */
const OrderDepositCard: React.FC<{
  order: OrderDetail;
  deposit: OrderSecurityDeposit;
  isAdmin: boolean;
  /** Opens the settlement page (record, or correct the recorded one). */
  onSettle: () => void;
  /** Opens the undo confirmation. */
  onUndo: () => void;
}> = ({ order, deposit, isAdmin, onSettle, onUndo }) => {
  const { t } = useTranslation();
  const money = (value: number): string => formatMoney(order.currency.symbol, value);
  const { settlement, canSettle } = deposit;
  const body = useMorphOnChange<HTMLDivElement>(`${settlement?.settledAt ?? ''}|${canSettle}`);

  const chip = settlement
    ? { label: t(`${KEY}.chipSettled`), tone: 'bg-emerald-50 text-emerald-600' }
    : canSettle
      ? { label: t(`${KEY}.chipPending`), tone: 'bg-amber-50 text-amber-600' }
      : undefined;

  const actionItems = isAdmin
    ? [
        ...(!settlement && canSettle
          ? [
              {
                key: 'settle',
                node: (
                  <Button
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineShieldCheck className="size-4" />}
                    onClick={onSettle}
                  >
                    {t(`${KEY}.settle`)}
                  </Button>
                ),
              },
            ]
          : []),
        ...(settlement && canSettle
          ? [
              {
                key: 'edit',
                node: (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlinePencilSquare className="size-4" />}
                    onClick={onSettle}
                  >
                    {t(`${KEY}.edit`)}
                  </Button>
                ),
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
      aria-labelledby="order-deposit-title"
      className="reveal-item flex flex-col gap-4 rounded-card bg-white p-5 ring-1 ring-black/[0.04]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="order-deposit-title" className="text-sm font-semibold text-charcoal">
          {t(`${KEY}.title`)}
        </h2>
        {chip && (
          <span
            className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${chip.tone}`}
          >
            {chip.label}
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
            {money(deposit.total)}
          </span>
        </div>

        {settlement ? (
          <div className="flex flex-col gap-2 border-t border-black/[0.06] pt-3">
            {settlement.claimsTotal === 0 && (
              <p className="text-charcoal/60">{t(`${KEY}.noClaims`)}</p>
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
          <p className="text-charcoal/60">{t(`${KEY}.${canSettle ? 'due' : 'notYet'}`)}</p>
        )}

        <ActionRow items={actionItems} className="flex flex-wrap items-center gap-2" />
      </div>
    </section>
  );
};

export default OrderDepositCard;
