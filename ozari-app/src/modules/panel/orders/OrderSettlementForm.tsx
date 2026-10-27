import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import CustomInputForm from '@components/CustomInputForm';
import CustomTextareaForm from '@components/CustomTextareaForm';
import FormError from '@components/FormError';
import { notify } from '@components/notifications/notify';
import { QueryKeys } from '@constants/QueryKeys';
import { toFormError } from '@utils/apiError';
import { decimalInput, integerInput } from '@utils/numericInput';
import { usePanelNavigate } from '../PanelNavContext';
import { FormSection } from '../products/ProductFormChrome';
import { formatMoney } from './orderEstimate';
import {
  createSettlementSchema,
  damageableLines,
  previewSettlement,
  settlementToFormValues,
  toSettleOrderBody,
  type SettlementFormValues,
} from './SchemaSettleOrder';
import type { OrderDetail, OrderSecurityDeposit } from './order.types';
import { useSettleOrder } from './useSettleOrder';

const KEY = 'modules.panel.orders.settlement';
const FORM_ID = 'order-settlement-form';
const SECONDARY_COLOR = '#262626';

/** One line of the live outcome: a label that may wrap beside an amount that never does. */
const PreviewLine: React.FC<{ label: string; amount: string; className?: string }> = ({
  label,
  amount,
  className = 'text-charcoal/60',
}) => (
  <div className={`flex items-start justify-between gap-4 text-sm ${className}`}>
    <span className="min-w-0 break-words">{label}</span>
    <span className="shrink-0 tabular-nums">{amount}</span>
  </div>
);

/**
 * The deposit SETTLEMENT form — mounted by `OrderSettlementPage` only once the order is loaded and
 * the API says it can be settled (RHF captures its defaults at mount, so a half-order would freeze
 * the wrong values in).
 *
 * The form recipe: RHF + a Zod schema mirroring the API's settlement validator (built per order —
 * the ceilings are this order's deposit and line quantities), `noValidate`, numeric fields as text
 * (`decimalInput` / `integerInput`), `skipErrorNotification` on the mutation and `toFormError` in
 * `onError` — so the 400 contract and the 409 "not delivered / cancelled / nothing to settle" land
 * in the inline banner, ambient failures toast, an outage stays silent.
 *
 * Declarative like every other full-state save: the body is the settlement's FINAL state, so an
 * edit prefills the recorded one and re-sends it whole. The outcome card is a LIVE ESTIMATE of the
 * API's formula, labelled as such; the saved numbers come back from the API and the detail page
 * shows only those.
 */
const OrderSettlementForm: React.FC<{ order: OrderDetail; deposit: OrderSecurityDeposit }> = ({
  order,
  deposit,
}) => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const queryClient = useQueryClient();
  const { settleOrder, isPending } = useSettleOrder();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const money = (value: number): string => formatMoney(order.currency.symbol, value);

  // Fixed for this mount: the page remounts the form for another order.
  const [lines] = useState(() => damageableLines(order.lines));
  const [lineById] = useState(
    () => new Map(lines.map((line) => [line.id, { quantity: line.quantity, unitAmount: line.replacementPrice }])),
  );
  const [schema] = useState(() =>
    createSettlementSchema({
      depositTotal: deposit.total,
      currencySymbol: order.currency.symbol,
      maxByLine: new Map(lines.map((line) => [line.id, line.quantity])),
    }),
  );
  const hasDeposit = deposit.total > 0;

  const methods = useForm<SettlementFormValues>({
    resolver: zodResolver(schema),
    defaultValues: settlementToFormValues(order),
    mode: 'onTouched',
  });
  const { handleSubmit, control } = methods;
  // `useWatch`, never `watch()` (the React Compiler lint) — the preview follows every keystroke.
  const values = useWatch({ control }) as SettlementFormValues;
  const preview = previewSettlement(deposit.total, values, lineById);
  const exitPath = `/panel/pedidos/${order.id}` as const;

  const onSubmit = (data: SettlementFormValues): void => {
    if (isPending) return;
    setFormError(undefined);
    settleOrder(
      { orderId: order.id, body: toSettleOrderBody(data) },
      {
        onSuccess: (response) => {
          // The response IS the re-projected order (the API's own settlement numbers) — seed the
          // detail with it so arriving back shows the record at once; the hook's invalidations
          // re-sync it (and the agenda's chip) in the background.
          const saved = response.data.data?.order;
          if (saved) queryClient.setQueryData([QueryKeys.ORDER, order.id], saved);
          notify.success(t(`${KEY}.successToast`, { client: order.clientName }), {
            title: t(`${KEY}.successTitle`),
          });
          panelNavigate(exitPath);
        },
        onError: (error) => {
          const { inline, toast } = toFormError(error, t(`${KEY}.errors.submitFallback`));
          if (inline) setFormError(inline);
          if (toast) notify.error(toast);
        },
      },
    );
  };

  return (
    <FormProvider {...methods}>
      {/* `noValidate`: our mirrored messages speak, never the browser's untranslated bubble. */}
      <form id={FORM_ID} noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        {hasDeposit && (
          <FormSection
            title={t(`${KEY}.sections.retention.title`)}
            description={t(`${KEY}.sections.retention.description`)}
          >
            <div className="flex flex-col gap-field">
              <CustomInputForm<SettlementFormValues>
                id="settlement-retained"
                name="retainedAmount"
                {...decimalInput}
                label={t(`${KEY}.fields.retainedLabel`)}
                placeholder={t(`${KEY}.fields.moneyPlaceholder`)}
                aria-label={t(`${KEY}.fields.retainedLabel`)}
                instructions={t(`${KEY}.fields.retainedHint`, { deposit: money(deposit.total) })}
                // Whether the reason is required follows this amount.
                deps={['retainedReason']}
              />
              <CustomTextareaForm<SettlementFormValues>
                id="settlement-reason"
                name="retainedReason"
                autoGrow
                label={t(`${KEY}.fields.reasonLabel`)}
                placeholder={t(`${KEY}.fields.reasonPlaceholder`)}
                aria-label={t(`${KEY}.fields.reasonLabel`)}
                instructions={t(`${KEY}.fields.reasonHint`)}
              />
            </div>
          </FormSection>
        )}

        {lines.length > 0 && (
          <FormSection
            title={t(`${KEY}.sections.damages.title`)}
            description={t(`${KEY}.sections.damages.description`)}
          >
            <div className="flex flex-col gap-4">
              {lines.map((line, index) => (
                <div
                  key={line.id}
                  className="flex min-w-0 flex-col gap-field rounded-control bg-charcoal/[0.03] p-4"
                >
                  <p className="min-w-0 break-words text-sm font-medium text-charcoal">
                    {line.productName}
                  </p>
                  {/* `gap-y-field`: a floated label paints above its own box, so the stacked
                      (phone) layout needs the clearance; the columns do not. */}
                  <div className="grid gap-x-4 gap-y-field sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <CustomInputForm<SettlementFormValues>
                        id={`settlement-damaged-${line.id}`}
                        name={`damages.${index}.quantity`}
                        {...integerInput}
                        label={t(`${KEY}.fields.damagedLabel`)}
                        placeholder={t(`${KEY}.fields.quantityPlaceholder`)}
                        aria-label={t(`${KEY}.fields.damagedAria`, { product: line.productName })}
                        instructions={t(`${KEY}.fields.damagedHint`, {
                          max: line.quantity,
                          unit: money(line.replacementPrice),
                        })}
                      />
                    </div>
                    <div className="min-w-0">
                      <CustomInputForm<SettlementFormValues>
                        id={`settlement-note-${line.id}`}
                        name={`damages.${index}.note`}
                        type="text"
                        optionalLabel
                        label={t(`${KEY}.fields.noteLabel`)}
                        placeholder={t(`${KEY}.fields.notePlaceholder`)}
                        aria-label={t(`${KEY}.fields.noteAria`, { product: line.productName })}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-xs text-charcoal/50">{t(`${KEY}.inventoryNote`)}</p>
            </div>
          </FormSection>
        )}

        <FormSection
          title={t(`${KEY}.sections.outcome.title`)}
          description={t(`${KEY}.sections.outcome.description`)}
        >
          <div className="flex flex-col gap-2 rounded-control bg-charcoal/[0.03] px-4 py-3">
            <PreviewLine label={t(`${KEY}.preview.deposit`)} amount={money(deposit.total)} />
            {hasDeposit && (
              <PreviewLine
                label={t(`${KEY}.preview.retained`)}
                amount={`−${money(preview.retainedAmount)}`}
              />
            )}
            {lines.length > 0 && (
              <PreviewLine
                label={t(`${KEY}.preview.damages`)}
                amount={`−${money(preview.damagesTotal)}`}
              />
            )}
            <div aria-live="polite" className="flex flex-col gap-2 border-t border-charcoal/10 pt-2">
              <PreviewLine
                label={t(`${KEY}.preview.refund`)}
                amount={money(preview.refundAmount)}
                className="font-semibold text-charcoal"
              />
              {/* Always mounted, collapsed by `grid-rows` — a line that appears mid-typing must
                  ease in, never pop and shove the card. */}
              <div
                aria-hidden={preview.balanceDue <= 0}
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
                  preview.balanceDue > 0 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <PreviewLine
                    label={t(`${KEY}.preview.balanceDue`)}
                    amount={money(preview.balanceDue)}
                    className="font-semibold text-red-600"
                  />
                </div>
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-charcoal/45">{t(`${KEY}.preview.note`)}</p>
        </FormSection>

        <div className="reveal-block flex flex-col">
          <FormError id="order-settlement-error" message={formError} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="soft"
              color={SECONDARY_COLOR}
              fullWidth
              disabled={isPending}
              onClick={() => panelNavigate(exitPath)}
              className="sm:w-auto"
            >
              {t(`${KEY}.actions.cancel`)}
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              color={SECONDARY_COLOR}
              fullWidth
              loading={isPending}
              className="sm:w-auto"
            >
              {t(`${KEY}.actions.submit`)}
            </Button>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};

export default OrderSettlementForm;
