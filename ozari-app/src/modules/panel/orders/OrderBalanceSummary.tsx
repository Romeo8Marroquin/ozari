import { useTranslation } from 'react-i18next';
import { squareOrderBalance } from './orderBalance';
import { formatMoney } from './orderEstimate';
import type { OrderDetail } from './order.types';

const KEY = 'modules.panel.orders.detail.money.balance';

/** One line of the cuadre: a label that may wrap beside an amount that never does. */
const Row: React.FC<{ label: string; amount: string; className?: string }> = ({
  label,
  amount,
  className = 'text-charcoal/60',
}) => (
  <div className={`flex items-start justify-between gap-4 ${className}`}>
    <span className="min-w-0 break-words">{label}</span>
    <span className="shrink-0 tabular-nums">{amount}</span>
  </div>
);

/**
 * The money card's CUADRE — under the cost (lines, delivery, discount, TOTAL), which never includes
 * the deposit, ONE answer to "what has to change hands now, and which way".
 *
 * Built only from `squareOrderBalance` (THE balancing rule, shared with the documents, so the page
 * and the paper always agree) over the API's figures: the total, the anticipo (`depositAmount` — the
 * ADVANCE, not the security deposit), whether it is paid, the security deposit's amount + collection
 * status, and the damage report's `claimsTotal`. Each row appears only when it says something:
 *
 * - before the report: "Anticipo" (−), "Saldo del servicio", "Saldo a favor del cliente" (− an
 *   anticipo above the cost, usually the deposit sent with it), "Depósito (reembolsable)" (+ while
 *   still to be handed over); a deposit already in hand is stated BELOW the result, outside the sum;
 * - after the report: "Daños" (+) and "Depósito recibido" (− credited back).
 *
 * Exactly one result: "Monto a pagar" (the light highlight), "Monto a devolver al cliente" (the
 * INVERTED highlight — charcoal with white text, so money going OUT never reads like money coming
 * in), or a plain "Sin saldo pendiente" when nothing moves.
 */
const OrderBalanceSummary: React.FC<{ order: OrderDetail }> = ({ order }) => {
  const { t } = useTranslation();
  const money = (value: number): string => formatMoney(order.currency.symbol, value);
  const deposit = order.securityDeposit;
  const advance = order.depositAmount ?? 0;
  const paid = order.paidAt !== undefined;
  const balance = squareOrderBalance({
    total: order.totalAmount,
    advance,
    paid,
    deposit: deposit?.collection
      ? { amount: deposit.total, status: deposit.collection.status }
      : undefined,
    claimsTotal: deposit?.settlement?.claimsTotal,
  });
  const showAdvance = !paid && advance > 0;
  // The service's own line is only worth a row when something else joins the sum.
  const showService =
    showAdvance || balance.depositDue > 0 || balance.claims > 0 || balance.depositCredit > 0;

  return (
    <div className="card-item mt-1 flex flex-col gap-2 border-t border-dashed border-black/[0.1] pt-3">
      {showAdvance && <Row label={t(`${KEY}.advance`)} amount={`−${money(advance)}`} />}
      {showService && <Row label={t(`${KEY}.serviceDue`)} amount={money(balance.serviceDue)} />}
      {/* An anticipo above the cost (usually the deposit sent with it) is credited, so the card
          still adds up — never silently dropped. Only possible with an anticipo on screen. */}
      {balance.advanceCredit > 0 && (
        <Row label={t(`${KEY}.advanceCredit`)} amount={`−${money(balance.advanceCredit)}`} />
      )}
      {balance.depositDue > 0 && (
        <Row label={t(`${KEY}.depositDue`)} amount={`+${money(balance.depositDue)}`} />
      )}
      {balance.claims > 0 && (
        <Row label={t(`${KEY}.claims`)} amount={`+${money(balance.claims)}`} />
      )}
      {balance.depositCredit > 0 && (
        <Row label={t(`${KEY}.depositCredit`)} amount={`−${money(balance.depositCredit)}`} />
      )}

      {balance.direction === 'collect' && (
        <Row
          label={t(`${KEY}.collect`)}
          amount={money(balance.amount)}
          className="rounded-control bg-charcoal/[0.05] px-3 py-2.5 font-bold text-charcoal"
        />
      )}
      {balance.direction === 'refund' && (
        <Row
          label={t(`${KEY}.refund`)}
          amount={money(balance.amount)}
          className="rounded-control bg-charcoal px-3 py-2.5 font-bold text-white"
        />
      )}
      {balance.direction === 'none' && (
        <Row label={t(`${KEY}.none`)} amount={money(0)} className="font-medium text-charcoal/60" />
      )}

      {/* Informational, OUTSIDE the sum: it is already ours to hold and goes back at pickup. */}
      {balance.depositOnHand > 0 && (
        <Row
          label={t(`${KEY}.depositOnHand`)}
          amount={money(balance.depositOnHand)}
          className="text-xs text-charcoal/50"
        />
      )}
    </div>
  );
};

export default OrderBalanceSummary;
