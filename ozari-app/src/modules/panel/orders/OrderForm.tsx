import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowPath,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineUserPlus,
} from 'react-icons/hi2';
import axios from 'axios';
import Button from '@components/Button';
import CustomInputForm from '@components/CustomInputForm';
import CustomSelect from '@components/CustomSelect';
import CustomSelectForm from '@components/CustomSelectForm';
import CustomTextareaForm from '@components/CustomTextareaForm';
import FormError from '@components/FormError';
import { notify } from '@components/notifications/notify';
import { QueryKeys } from '@constants/QueryKeys';
import { getStoredUserId } from '@hooks/useRole';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { getStatus, toFormError } from '@utils/apiError';
import {
  detailRowIn,
  detailRowOut,
  revealInScroller,
  SECTION_REVEAL_STEP,
  staggerIn,
  staggerOut,
} from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import PreferencesCta from '../PreferencesCta';
import type { Product } from '../products/product.types';
import ProductsStatus from '../products/ProductsStatus';
import SectionReveal from '../products/SectionReveal';
import ClientRegistryModal from './ClientRegistryModal';
import { CHANNEL_INPUT_MODE, contactChannelKind } from '@constants/Regex';
import ContactChannelIcon from './ContactChannelIcon';
import type { ClientRegistry, OrderDetail, OrderStockConflictItem } from './order.types';
import {
  billedDaysFromStrings,
  estimateLineSubtotal,
  estimateOrderTotal,
  formatMoney,
  isRentalProduct,
  lineUnitPrice,
} from './orderEstimate';
import {
  appendLineAvailabilityErrors,
  createOrderDefaultValues,
  createOrderRequiredPatterns,
  createOrderSchema,
  nowDateTimeLocal,
  orderToFormValues,
  parseDateTime,
  parseLineQuantity,
  parseMoney,
  reconcileToastDuration,
  takeableFor,
  toCreateOrderBody,
  updateOrderSchema,
  type CreateOrderFormType,
} from './SchemaCreateOrder';
import { useClientRegistries } from './useClientRegistries';
import { useCreateOrder } from './useCreateOrder';
import { useOrderAvailability } from './useOrderAvailability';
import { useOrderProducts } from './useOrderProducts';
import { useOrdersCatalog } from './useOrdersCatalog';
import { useUpdateOrder } from './useUpdateOrder';

const FORM_ID = 'create-order-form';
const KEY = 'modules.panel.orders.create';
/** The handful of strings an EDIT phrases differently; every field label is shared with create. */
const EKEY = 'modules.panel.orders.edit';
const SECONDARY_COLOR = '#262626';

interface OrderFormProps {
  /** `create` (default) posts a new order; `edit` prefills from `order` and saves through PUT. */
  mode?: 'create' | 'edit';
  /** The order being edited — required in `edit` mode, and the source of every default value. */
  order?: OrderDetail;
}

/** A section card matching the panel surface language — each one is a `.reveal-block`. */
const Section: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <section className="reveal-block min-w-0 rounded-card border border-charcoal/[0.07] bg-white px-5 py-5 shadow-sm sm:px-6">
    <h3 className="text-base font-semibold text-charcoal">{title}</h3>
    <p className="mb-5 mt-1 text-sm leading-relaxed text-charcoal/55">{description}</p>
    {children}
  </section>
);

/** A catalog usable enough to build an order: at least one event type and one contact type
 *  (zones are optional). An empty payload (unseeded reference data) = a genuine setup problem. */
const isReady = (
  catalog: { eventTypes: unknown[]; contactTypes: unknown[] } | null | undefined,
): boolean => Boolean(catalog && catalog.eventTypes.length > 0 && catalog.contactTypes.length > 0);

/**
 * One product line: registers its element (so removal can tween it out) and grows in from the left
 * like a list entry on mount — the exact `detailRowIn`/`detailRowOut` language as the product form's
 * detail sub-editor. Every line is user-added post-reveal (this create form has no draft/initial
 * rows), so every mount animates in; `detailRowIn` no-ops under reduced motion.
 */
const LineRow: React.FC<{
  onRegister: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}> = ({ onRegister, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    detailRowIn(ref.current);
    // The new line is what the click asked for, so it must not open below the fold — the panel
    // follows it by the minimum needed, on the same curve as the row's own growth.
    revealInScroller(ref.current);
  }, []);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        onRegister(el);
      }}
      // `pb` groups a line's price note with its OWN row and widens the visual gap to the next row
      // (the flex `gap` between rows stays 20px for the `detailRowOut` collapse math). It's part of
      // the row height, so the enter/exit height animations still swallow it cleanly.
      className="flex items-start gap-3 pb-2"
    >
      {children}
    </div>
  );
};

/**
 * A product line's price note (unit + subtotal), collapsing open/closed with the SAME motion as
 * `FormError` — the row height eases via a `grid-rows` 0fr↔1fr trick and the text fades, so it never
 * pops. The last product is kept painted while collapsing (deselecting a product) so the text
 * doesn't vanish mid-animation. `product` is referentially stable per id (a `useMemo` map), so the
 * "adjust state during render" pattern below is loop-free.
 */
const LineSubtotalNote: React.FC<{
  product: Product | undefined;
  quantity: number;
  billedDays: number;
}> = ({ product, quantity, billedDays }) => {
  const { t } = useTranslation();
  // Keep the last product painted while the whole note collapses (deselecting a product).
  const [displayed, setDisplayed] = useState(product);
  const [prevProduct, setPrevProduct] = useState(product);
  if (product !== prevProduct) {
    setPrevProduct(product);
    if (product) setDisplayed(product);
  }
  // The subtotal segment shows only with a quantity. Keep its last amount painted while it fades out
  // (clearing the quantity) so the number doesn't jump to 0 mid-fade. `amount` is a primitive, so the
  // adjust-during-render comparison is loop-free.
  const amount = product && quantity > 0 ? estimateLineSubtotal(product, quantity, billedDays) : undefined;
  const [displayedAmount, setDisplayedAmount] = useState(amount);
  const [prevAmount, setPrevAmount] = useState(amount);
  if (amount !== prevAmount) {
    setPrevAmount(amount);
    if (amount !== undefined) setDisplayedAmount(amount);
  }

  const open = Boolean(product);
  const showSubtotal = amount !== undefined;
  return (
    <div
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
    >
      <div className="overflow-hidden">
        {displayed && (
          <p
            className={`px-2 pt-1 text-xs text-charcoal/55 transition-opacity duration-300 ease-in-out motion-reduce:transition-none ${
              open ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="tabular-nums">
              {formatMoney(displayed.currency.symbol, lineUnitPrice(displayed))}
            </span>{' '}
            {t(`${KEY}.fields.lineUnitEach`)}
            {/* The subtotal segment FADES in/out (inline) instead of popping when a quantity is set. */}
            <span
              className={`transition-opacity duration-300 ease-in-out motion-reduce:transition-none ${
                showSubtotal ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {' · '}
              {t(`${KEY}.fields.lineSubtotal`)}{' '}
              <span className="font-semibold tabular-nums text-charcoal/70">
                {displayedAmount !== undefined ? formatMoney(displayed.currency.symbol, displayedAmount) : ''}
              </span>
            </span>
          </p>
        )}
      </div>
    </div>
  );
};

const SKELETON = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/** A section's shimmer body while the form data loads — the card chrome (title/description) stays
 *  REAL; only the value-dependent body shimmers, then `SectionReveal` morphs it to the fields. */
const BodySkeleton: React.FC<{ rows: number }> = ({ rows }) => (
  <div className="flex flex-col gap-5">
    {Array.from({ length: rows }).map((_, i) => (
      <span key={i} aria-hidden className={`block h-11 w-full ${SKELETON}`} />
    ))}
  </div>
);

/**
 * The whole-view swap (form ↔ error ↔ empty-products), riding the panel vocabulary instead of a
 * hard React replace: the current view's `.reveal-block`s sweep OUT, then the next view commits and
 * sweeps IN — the same doctrine as the product form's loader. The initial mount renders its target
 * directly (the page entrance owns that motion); reduced motion swaps instantly in the helpers.
 */
type OrderFormView = 'form' | 'error' | 'config' | 'emptyProducts';
function useOrderViewSwap(
  target: OrderFormView,
  root: React.RefObject<HTMLDivElement | null>,
): OrderFormView {
  const [rendered, setRendered] = useState(target);
  const isInitial = useRef(true);

  useEffect(() => {
    if (target === rendered) return;
    let cancelled = false;
    void staggerOut(root.current, '.reveal-block').then(() => {
      if (!cancelled) setRendered(target);
    });
    return () => {
      cancelled = true;
    };
  }, [target, rendered, root]);

  useLayoutEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    staggerIn(root.current, '.reveal-block');
  }, [rendered, root]);

  return rendered;
}

/**
 * The admin order-creation form (the WhatsApp/phone walk-in flow). Owns its errors per the form
 * doctrine (`skipErrorNotification` + `toFormError`): the 400 validation and the 409 stock/spacing
 * conflict land inline — a stock 409's `data.conflicts` maps back onto the offending line's
 * quantity field with the real available count (EPIC-2 §8) — while ambient failures toast.
 *
 * In **edit** mode the very same form is prefilled from the order and saves through
 * `PUT /orders/:id` — one component, because an edit describes exactly the same thing a create does
 * and two copies would drift. What differs is only: where the defaults come from, which mutation
 * runs, the submit label, and where a save lands (back on the order, not on the agenda).
 *
 * Step zero is the MODE fork (rent / buy / both), which filters the product picker and, together
 * with which lines are rentals, decides whether a pickup exists (Q-A). Selecting a client registry
 * prefills the delivery snapshots (editable — parties rarely happen at the client's home); a "new
 * client" button opens {@link ClientRegistryModal} inline. Pricing is derived SERVER-SIDE; the form
 * shows an on-brand ESTIMATE (mirrors the backend formula) so the admin can quote on the phone.
 */
const OrderForm: React.FC<OrderFormProps> = ({ mode = 'create', order }) => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const queryClient = useQueryClient();
  const catalogQuery = useOrdersCatalog();
  const productsQuery = useOrderProducts();
  const registriesQuery = useClientRegistries();
  const { createOrder, isPending: isCreating } = useCreateOrder();
  const { updateOrder, isPending: isUpdating } = useUpdateOrder();
  const { checkAvailability } = useOrderAvailability();
  const isEdit = mode === 'edit' && order !== undefined;
  const isSaving = isCreating || isUpdating;

  const [registryModalOpen, setRegistryModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  // Per-product takeable amounts for the current window (null = a rental with no pickup yet). Drives
  // the picker annotations + the line reconciliation; empty until a valid delivery date is set.
  const [availability, setAvailability] = useState<Map<number, number | null>>(new Map());

  const catalog = catalogQuery.data;
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const registries = useMemo(() => registriesQuery.data ?? [], [registriesQuery.data]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // A resolver that runs the mirrored schema, then layers the LIVE per-window availability cap on top
  // (refs so it always reads the freshest amounts without rebuilding the resolver on every probe). This
  // blocks an over-stock line as the admin types — the same limit the backend enforces with a 409. The
  // refs are synced in an effect (validation only fires on user interaction, well after it commits).
  const availabilityRef = useRef(availability);
  const productsByIdRef = useRef(productsById);
  useEffect(() => {
    availabilityRef.current = availability;
    productsByIdRef.current = productsById;
  }, [availability, productsById]);
  // An EDIT may move the delivery anywhere, including into the past (owner decision 2026-07-29):
  // the order already happened, or is being corrected for a reason the form can't know. Creating
  // still refuses a past date. The pickup-after-delivery rule holds in both.
  const zodResolve = useMemo(
    () => zodResolver(mode === 'edit' ? updateOrderSchema : createOrderSchema),
    [mode],
  );
  const resolver = useCallback<Resolver<CreateOrderFormType>>(
    async (values, context, options) => {
      const result = await zodResolve(values, context, options);
      return appendLineAvailabilityErrors(
        values,
        result,
        (productId) => takeableFor(productId, availabilityRef.current, productsByIdRef.current),
        (available) => t(`${KEY}.errors.lineUnavailable`, { available }),
      );
    },
    [zodResolve, t],
  );

  // CREATE: the "Asignar a" select defaults to the CREATING admin (the token's userId), so a created
  // order is never unassigned and the admin's own orders read as `isMine` on the agenda. A null id
  // (defensive — an admin always has one) leaves the select on its placeholder, which the required
  // rule then blocks on submit.
  // EDIT: every value comes from the order itself, so saving an untouched form sends exactly what is
  // already stored. Computed once — RHF captures defaults at mount, and the edit page only mounts
  // this component once the order has loaded.
  const defaultValues = useMemo<CreateOrderFormType>(
    () =>
      order
        ? orderToFormValues(order)
        : { ...createOrderDefaultValues, assignedUserId: getStoredUserId() as unknown as number },
    [order],
  );
  const methods = useForm<CreateOrderFormType>({
    resolver,
    defaultValues,
    mode: 'onTouched',
  });
  const { handleSubmit, control, setValue, getValues, setError } = methods;
  const lines = useFieldArray({ control, name: 'lines' });

  // A removed line tweens OUT before RHF drops it (`detailRowOut`), so the list shrinks smoothly.
  // A ref-mirror of the fields gives the exit handler the LIVE index at completion (indices may
  // shift meanwhile); the `index !== -1` check makes a double-remove a safe no-op, so no guard.
  const lineRowRefs = useRef(new Map<string, HTMLDivElement>());
  const latestLineFields = useRef(lines.fields);
  useEffect(() => {
    latestLineFields.current = lines.fields;
  }, [lines.fields]);
  const removeLine = (id: string): void => {
    /* v8 ignore next -- `?? null`: a rendered row always has its element registered */
    void detailRowOut(lineRowRefs.current.get(id) ?? null).then(() => {
      const index = latestLineFields.current.findIndex((row) => row.id === id);
      /* v8 ignore next -- defensive: only reachable if the row already left (a raced double-remove) */
      if (index !== -1) lines.remove(index);
    });
  };

  // Live line values drive the mode filter, the per-line isRental sync, the pickup rule, and the
  // estimate. `useWatch` (not `watch()`) keeps the React Compiler able to memoize this component.
  const lineValues = useWatch({ control, name: 'lines' });
  const deliveryAt = useWatch({ control, name: 'deliveryAt' });
  const pickupAt = useWatch({ control, name: 'pickupAt' });
  const deliveryAmountRaw = useWatch({ control, name: 'deliveryAmount' });
  const deliveryContactValue = useWatch({ control, name: 'deliveryContact' });
  const deliveryAddressValue = useWatch({ control, name: 'deliveryAddress' });
  const deliveryContactTypeId = useWatch({ control, name: 'deliveryContactTypeId' });
  const deliveryZoneId = useWatch({ control, name: 'deliveryZoneId' });

  // Keep each line's isRental flag in sync with its picked product (the schema's pickup rule reads
  // it). Converges — only writes when the flag actually differs, so it never loops.
  useEffect(() => {
    lineValues.forEach((line, index) => {
      if (line.productId == null) return;
      const product = productsById.get(line.productId);
      /* v8 ignore next -- a line only ever holds a loaded product's id; the `: false` is defensive */
      const rental = product ? isRentalProduct(product) : false;
      if (line.isRental !== rental) {
        setValue(`lines.${index}.isRental`, rental);
      }
    });
  }, [lineValues, productsById, setValue]);

  const anyRental = lineValues.some((line) => line.isRental);

  // Selecting a client prefills the delivery snapshots from their principal contact + favorite
  // address (overwriting on a real change — a new client loads their defaults; the admin edits
  // freely afterwards for a one-off venue). Never fires on the initial mount.
  const registriesById = useMemo(
    () => new Map(registries.map((r) => [r.id, r])),
    [registries],
  );
  const clientRegistryId = useWatch({ control, name: 'clientRegistryId' });
  // Seeded with the order's OWN client when editing, so the prefill below sees no change on mount:
  // an existing order's snapshots are what was actually agreed, and overwriting them with the
  // client's current defaults would silently rewrite the contact, address and delivery fee.
  const previousRegistryId = useRef<number | null>(order?.clientRegistryId ?? null);
  useEffect(() => {
    if (clientRegistryId == null || clientRegistryId === previousRegistryId.current) return;
    previousRegistryId.current = clientRegistryId;
    const registry = registriesById.get(clientRegistryId);
    if (!registry) return;
    const contact = registry.contacts.find((c) => c.isPrincipal) ?? registry.contacts[0];
    const address = registry.addresses.find((a) => a.isFavorite) ?? registry.addresses[0];
    setValue('deliveryName', registry.name, { shouldValidate: true });
    if (contact) {
      setValue('deliveryContact', contact.value, { shouldValidate: true });
      // The contact's channel (drives the icon + keyboard; editable). Null clears to the generic.
      setValue('deliveryContactTypeId', contact.contactType.id);
    }
    if (address) setValue('deliveryAddress', address.address, { shouldValidate: true });
    // Delivery zone (drives the fee suggestion; editable) + the fee itself: the favorite address's
    // explicit price, else its zone's default fee — clear when neither exists so a prior client's
    // fee never lingers. All editable afterwards.
    setValue('deliveryZoneId', address?.zone?.id ?? null);
    const fee = address?.domicilePrice ?? address?.zone?.deliveryFee;
    setValue('deliveryAmount', fee != null ? String(fee) : '', { shouldValidate: true });
    // Payment method: pre-select the client's preferred (null = clear to "unspecified").
    setValue('paymentMethodId', registry.preferredPaymentMethod?.id ?? null);
  }, [clientRegistryId, registriesById, setValue]);

  // Reconcile the picked lines against fresh availability (the "adjust to available + notify" rule):
  // a line over its window availability is REDUCED to what's takeable, or REMOVED when nothing is
  // left; a toast summarises the changes. Lines with UNKNOWN availability (a rental with no pickup
  // yet, or a product not in the response) are left untouched. Stable deps (RHF's `getValues`/
  // `setValue`/`lines.remove` are memoized; `productsById` is a `useMemo`), so the fetch effect below
  // that depends on it never re-fires spuriously.
  const reconcileAvailability = useCallback(
    (map: Map<number, number | null>): void => {
      const current = getValues('lines');
      // Capture each change as structured data (name + old → new) so the toast can lay them out one
      // per line. Iterate bottom-up so removals don't shift the indices still to process.
      const adjusted: { name: string; from: number; to: number }[] = [];
      const removed: string[] = [];
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const line = current[index];
        const available = line.productId != null ? map.get(line.productId) : undefined;
        if (available == null) continue;
        const qty = parseLineQuantity(line.quantity);
        if (qty == null || qty <= available) continue;
        /* v8 ignore next -- `?? ''`: a line with availability always holds a loaded product */
        const name = productsById.get(line.productId)?.name ?? '';
        if (available === 0) {
          lines.remove(index);
          removed.push(name);
        } else {
          setValue(`lines.${index}.quantity`, String(available), { shouldValidate: true });
          adjusted.push({ name, from: qty, to: available });
        }
      }
      if (adjusted.length === 0 && removed.length === 0) return;
      // Reverse back to natural top-to-bottom order (we walked the lines bottom-up), then build a
      // multi-line body: a heading per group and each product on its own `\n`-separated row.
      adjusted.reverse();
      removed.reverse();
      const rows: string[] = [];
      if (adjusted.length > 0) {
        rows.push(t(`${KEY}.availability.adjustedHeading`));
        adjusted.forEach(({ name, from, to }) =>
          rows.push(t(`${KEY}.availability.adjustedItem`, { name, from, to })),
        );
      }
      if (removed.length > 0) {
        rows.push(t(`${KEY}.availability.removedHeading`));
        removed.forEach((name) => rows.push(t(`${KEY}.availability.removedItem`, { name })));
      }
      notify.warning(rows.join('\n'), {
        title: t(`${KEY}.availability.reconciledTitle`),
        duration: reconcileToastDuration(adjusted.length + removed.length),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lines.remove is a stable RHF method
    [getValues, productsById, setValue, t],
  );

  // Fetch availability whenever the WINDOW changes (debounced): a valid delivery date is enough for
  // sales, and the pickup adds the rental window. On success, store the amounts (picker annotations)
  // and reconcile the picked lines. Availability is ADVISORY — a probe failure stays silent (the
  // create still re-checks under the lock), so the mutation carries `skipErrorNotification`.
  useEffect(() => {
    const delivery = parseDateTime(deliveryAt);
    if (!delivery) return undefined;
    const pickup = parseDateTime(pickupAt);
    const productIds = products.map((product) => product.id);
    const timer = window.setTimeout(() => {
      checkAvailability(
        {
          deliveryAt: delivery.toISOString(),
          ...(pickup && { pickupAt: pickup.toISOString() }),
          productIds,
        },
        {
          onSuccess: (response) => {
            const list = response.data.data?.availability ?? [];
            setAvailability(new Map(list.map((item) => [item.productId, item.available])));
            reconcileAvailability(new Map(list.map((item) => [item.productId, item.available])));
          },
        },
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [deliveryAt, pickupAt, products, checkAvailability, reconcileAvailability]);

  const onRegistryCreated = (registry: ClientRegistry): void => {
    // Seed the picker cache so the new client appears immediately, then select it (the prefill
    // effect fills the snapshots).
    queryClient.setQueryData<ClientRegistry[]>([QueryKeys.CLIENT_REGISTRIES], (prev) =>
      prev ? [registry, ...prev] : [registry],
    );
    setValue('clientRegistryId', registry.id, { shouldValidate: true });
  };

  // A stock 409 lists exactly which lines lack units — map each back onto its quantity field with
  // the real available count, so the admin can adjust in place (the backend is the guard).
  const applyStockConflicts = (conflicts: OrderStockConflictItem[]): void => {
    const current = getValues('lines');
    conflicts.forEach((conflict) => {
      const index = current.findIndex((line) => line.productId === conflict.productId);
      if (index !== -1) {
        setError(`lines.${index}.quantity`, {
          message: t(`${KEY}.errors.lineUnavailable`, { available: conflict.available }),
        });
      }
    });
  };

  const onSubmit = (data: CreateOrderFormType): void => {
    if (isSaving) return;
    setFormError(undefined);
    const body = toCreateOrderBody(data);
    // Both flows share every failure path — the 400 contract and the 409 conflicts are identical,
    // because the endpoints validate against the same contract. Only the destination differs: a new
    // order lands on the agenda, an edited one returns to the order you were looking at.
    const onError = (error: unknown): void => {
      // A stock 409 carries structured conflicts — surface them per-line AND in the banner.
      if (axios.isAxiosError(error) && getStatus(error) === 409) {
        const conflicts = (error.response?.data as { data?: { conflicts?: OrderStockConflictItem[] } })
          ?.data?.conflicts;
        if (conflicts?.length) applyStockConflicts(conflicts);
      }
      const { inline, toast } = toFormError(error, t(`${KEY}.errors.submitFallback`));
      if (inline) setFormError(inline);
      if (toast) notify.error(toast);
    };

    if (isEdit) {
      updateOrder(
        { orderId: order.id, body },
        {
          onSuccess: (response) => {
            // The response IS the re-projected order (re-priced, re-derived actions, everything) —
            // seed the detail cache with it so arriving back shows the saved state immediately,
            // with no flash of the values we just replaced. The invalidations then re-sync from the
            // server in the background: the ORDER because a concurrent advance may have moved it,
            // and the AGENDA because its row shows this order's dates, client and total.
            const saved = response.data.data?.order;
            if (saved) queryClient.setQueryData([QueryKeys.ORDER, order.id], saved);
            void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDERS] });
            void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDER, order.id] });
            notify.success(t(`${EKEY}.successToast`), { title: t(`${EKEY}.successTitle`) });
            panelNavigate(`/panel/pedidos/${order.id}`);
          },
          onError,
        },
      );
      return;
    }
    createOrder(body, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDERS] });
        notify.success(t(`${KEY}.successToast`), { title: t(`${KEY}.successTitle`) });
        panelNavigate('/panel/pedidos');
      },
      onError,
    });
  };

  const requiredPatternsValue = useMemo(
    () => ({ requiredPatterns: createOrderRequiredPatterns }),
    [],
  );

  const isLoading = catalogQuery.isLoading || productsQuery.isLoading || registriesQuery.isLoading;
  const isFetching = catalogQuery.isFetching || productsQuery.isFetching || registriesQuery.isFetching;
  // Four distinct outcomes, each with the RIGHT affordance (never a blanket "retry"):
  //  - `requestError`  — a request actually failed (network / 5xx / …) → RETRY (+ the interceptor's
  //     own ambient notification already fired, per the app-wide error doctrine).
  //  - `configMissing` — every request SUCCEEDED but the seeded reference/preference data is empty
  //     (no event types / contact types) → this is a setup gap, not a failure to retry → route to
  //     PREFERENCES (bound later; Settings is the placeholder home).
  //  - `emptyProducts` — loaded fine but the catalog is empty → a friendly "create a product" nudge
  //     (you can't build an order without products). An empty REGISTRY list is NOT a blocker.
  //  - otherwise `form` — whose section cards skeleton-reveal until `dataReady`.
  const requestError = catalogQuery.isError || productsQuery.isError || registriesQuery.isError;
  const catalogUsable = isReady(catalog);
  const configMissing = !isLoading && !requestError && !catalogUsable;
  const dataReady = !isLoading && !requestError && catalogUsable;
  const emptyProducts = dataReady && products.length === 0;
  const refetchAll = (): void => {
    void catalogQuery.refetch();
    void productsQuery.refetch();
    void registriesQuery.refetch();
  };

  const targetView: OrderFormView = requestError
    ? 'error'
    : configMissing
      ? 'config'
      : emptyProducts
        ? 'emptyProducts'
        : 'form';
  const viewRoot = useRef<HTMLDivElement>(null);
  const renderedView = useOrderViewSwap(targetView, viewRoot);

  // The estimate + its currency symbol (from the first picked product; the seeded catalog is GTQ).
  const firstPicked = lineValues
    .map((line) => (line.productId != null ? productsById.get(line.productId) : undefined))
    .find((product): product is Product => product !== undefined);
  const currencySymbol = firstPicked?.currency.symbol ?? 'Q';
  // Billed days for the current window (for the per-line rental math) + the money breakdown: the
  // products subtotal on its own, the delivery fee, and the total.
  const billedDays = billedDaysFromStrings(deliveryAt, anyRental ? pickupAt : '');
  const linesSubtotal = estimateOrderTotal(
    lineValues.flatMap((line) =>
      line.productId != null ? [{ productId: line.productId, quantity: line.quantity }] : [],
    ),
    productsById,
    parseDateTime(deliveryAt),
    anyRental ? parseDateTime(pickupAt) : null,
    0,
  );
  const deliveryFee = parseMoney(deliveryAmountRaw) ?? 0;
  const estimate = Math.round((linesSubtotal + deliveryFee) * 100) / 100;

  // Saved-data quick-fill: the selected client's contacts/addresses become picker options that fill
  // the (always-editable) snapshot fields. The picker's value is DERIVED from the current text —
  // matching a saved row shows it, editing to a one-off shows the placeholder — so there's no
  // convergent effect to keep in sync.
  const selectedRegistry = clientRegistryId != null ? registriesById.get(clientRegistryId) : undefined;
  // A saved item matches (and the picker auto-selects it) only when EVERY field lines up — the
  // contact's type AND value, the address's text AND zone. Changing any one flips it to "custom".
  const savedContactId = selectedRegistry?.contacts.find(
    (c) => c.value === deliveryContactValue && c.contactType.id === deliveryContactTypeId,
  )?.id;
  const savedAddressId = selectedRegistry?.addresses.find(
    (a) => a.address === deliveryAddressValue && (a.zone?.id ?? null) === deliveryZoneId,
  )?.id;
  const contactKind = contactChannelKind(deliveryContactTypeId);
  const pickSavedContact = (value: string): void => {
    const contact = selectedRegistry?.contacts.find((c) => String(c.id) === value);
    if (contact) {
      setValue('deliveryContact', contact.value, { shouldValidate: true });
      setValue('deliveryContactTypeId', contact.contactType.id);
    }
  };
  const pickSavedAddress = (value: string): void => {
    const address = selectedRegistry?.addresses.find((a) => String(a.id) === value);
    if (!address) return;
    setValue('deliveryAddress', address.address, { shouldValidate: true });
    setValue('deliveryZoneId', address.zone?.id ?? null);
    const fee = address.domicilePrice ?? address.zone?.deliveryFee;
    if (fee != null) setValue('deliveryAmount', String(fee), { shouldValidate: true });
  };
  // Choosing a delivery zone (for a one-off venue) suggests that zone's fee — editable afterwards.
  const pickDeliveryZone = (value: string): void => {
    const zoneId = value === '' ? null : Number(value);
    setValue('deliveryZoneId', zoneId);
    /* v8 ignore next -- `?? []`: the catalog is always loaded before the zone select is interactive */
    const fee = (catalog?.zones ?? []).find((z) => z.id === zoneId)?.deliveryFee;
    if (fee != null) setValue('deliveryAmount', String(fee), { shouldValidate: true });
  };

  const usedProductIds = new Set(
    lineValues.map((line) => line.productId).filter((id): id is number => id != null),
  );
  // The picker offers ALL products (rent + sale) — the order's kind is DERIVED from what's picked (any
  // rental line ⇒ a pickup is required); no upfront mode fork. Already-picked products are hidden. The
  // dropdown shows ONLY the product name; the takeable amount lives as a quiet hint under its quantity.
  const optionsFor = (currentId: number | null | undefined) =>
    products
      .filter((product) => product.id === currentId || !usedProductIds.has(product.id))
      .map((product) => ({ value: product.id, label: product.name }));
  const canAddLine = lines.fields.length < products.length;
  // The takeable ceiling for a line's product — the window amount once probed, else the product's
  // current availability. Caps the quantity input's `max` (the resolver enforces the same limit).
  const availableFor = (productId: number | null | undefined): number | undefined =>
    productId == null ? undefined : takeableFor(productId, availability, productsById);
  // A quiet hint under the quantity: how many of the picked product are takeable (the window amount
  // once dated, else its general availability). Empty until a product is chosen — and the field's own
  // "only N available" error replaces it — so the number surfaces once, right where it's relevant.
  const availabilityHint = (productId: number | null | undefined): string => {
    const amount = availableFor(productId);
    if (amount == null) return '';
    return amount === 0 ? t(`${KEY}.availability.soldOut`) : t(`${KEY}.availability.count`, { count: amount });
  };
  // The section cards' bodies skeleton-reveal until every query has landed (a warm cache reveals
  // instantly). `loading` is per-section; the cards cascade via `SECTION_REVEAL_STEP`.
  const revealing = !dataReady;

  return (
    <div ref={viewRoot} className="flex w-full flex-1 flex-col">
      {isLoading && <span role="status" aria-label={t(`${KEY}.loading`)} className="sr-only" />}

      {renderedView === 'error' ? (
        // A REAL request failure → retry (the interceptor already surfaced an ambient notice).
        <div className="reveal-block flex flex-1 flex-col">
          <ProductsStatus
            tone="error"
            title={t(`${KEY}.loadError.title`)}
            description={t(`${KEY}.loadError.description`)}
            action={
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                size="sm"
                loading={isFetching}
                startIcon={<HiOutlineArrowPath className="size-4" />}
                onClick={refetchAll}
              >
                {t(`${KEY}.loadError.retry`)}
              </Button>
            }
          />
        </div>
      ) : renderedView === 'config' ? (
        // Requests SUCCEEDED but the seeded reference data is missing — a setup gap, not a failure
        // to retry. Route to preferences (bound later; Settings is the placeholder home).
        <div className="reveal-block flex flex-1 flex-col">
          <ProductsStatus
            tone="config"
            title={t(`${KEY}.configMissing.title`)}
            description={t(`${KEY}.configMissing.description`)}
            action={<PreferencesCta />}
          />
        </div>
      ) : renderedView === 'emptyProducts' ? (
        // NOT an error — there's simply nothing to order yet. Friendly nudge to the catalog.
        <div className="reveal-block flex flex-1 flex-col">
          <ProductsStatus
            tone="empty"
            title={t(`${KEY}.emptyProducts.title`)}
            description={t(`${KEY}.emptyProducts.description`)}
            action={
              <Button
                size="sm"
                startIcon={<HiOutlinePlus className="size-4" />}
                onClick={() => panelNavigate('/panel/productos/nuevo')}
              >
                {t(`${KEY}.emptyProducts.action`)}
              </Button>
            }
          />
        </div>
      ) : (
        <RequiredPatternsContext.Provider value={requiredPatternsValue}>
          <FormProvider {...methods}>
            <form
              id={FORM_ID}
              onSubmit={handleSubmit(onSubmit)}
              aria-busy={isLoading}
              className="flex flex-col gap-6"
            >
              {/* CLIENT — pick a walk-in registry or create one inline. */}
              <Section title={t(`${KEY}.sections.client.title`)} description={t(`${KEY}.sections.client.description`)}>
                <SectionReveal loading={revealing} skeleton={<BodySkeleton rows={1} />}>
                  <div className="reveal-item flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <CustomSelectForm<CreateOrderFormType>
                        id="order-client"
                        name="clientRegistryId"
                        label={t(`${KEY}.fields.clientLabel`)}
                        placeholderOption={
                          registries.length === 0
                            ? t(`${KEY}.fields.clientEmpty`)
                            : t(`${KEY}.fields.clientPlaceholder`)
                        }
                        options={registries.map((r) => ({ value: r.id, label: r.name }))}
                      />
                    </div>
                    <Button
                      variant="soft"
                      color={SECONDARY_COLOR}
                      size="sm"
                      startIcon={<HiOutlineUserPlus className="size-4" />}
                      onClick={() => setRegistryModalOpen(true)}
                      className="shrink-0 sm:mt-0.5"
                    >
                      {t(`${KEY}.actions.newClient`)}
                    </Button>
                  </div>
                </SectionReveal>
              </Section>

              {/* EVENT + DATES — always both dates (set them before products if you like). Pickup is
                  REQUIRED only when the order carries a rental; ignored for a purchase-only order. */}
              <Section title={t(`${KEY}.sections.event.title`)} description={t(`${KEY}.sections.event.description`)}>
                <SectionReveal loading={revealing} delaySeconds={SECTION_REVEAL_STEP} skeleton={<BodySkeleton rows={2} />}>
                  <div className="flex flex-col gap-5">
                    <div className="reveal-item">
                      <CustomSelectForm<CreateOrderFormType>
                        id="order-event-type"
                        name="eventTypeId"
                        label={t(`${KEY}.fields.eventTypeLabel`)}
                        placeholderOption={t(`${KEY}.fields.eventTypePlaceholder`)}
                        options={(catalog?.eventTypes ?? []).map((e) => ({ value: e.id, label: e.name }))}
                      />
                    </div>
                    <div className="reveal-item grid gap-5 sm:grid-cols-2">
                      <CustomInputForm<CreateOrderFormType>
                        id="order-delivery-at"
                        name="deliveryAt"
                        type="datetime-local"
                        // CREATE: never a past delivery (the admin's one date rule) — the schema and
                        // the backend also guard it; this just stops the native picker offering
                        // earlier slots. EDIT: no floor at all — an order being corrected may be
                        // moved anywhere, so the picker must not fight the rule the schema drops.
                        {...(!isEdit && { min: nowDateTimeLocal() })}
                        label={t(`${KEY}.fields.deliveryAtLabel`)}
                        aria-label={t(`${KEY}.fields.deliveryAtLabel`)}
                      />
                      <CustomInputForm<CreateOrderFormType>
                        id="order-pickup-at"
                        name="pickupAt"
                        type="datetime-local"
                        min={deliveryAt || undefined}
                        optionalLabel={!anyRental}
                        label={t(`${KEY}.fields.pickupAtLabel`)}
                        aria-label={t(`${KEY}.fields.pickupAtLabel`)}
                        instructions={t(`${KEY}.fields.pickupAtHint`)}
                      />
                    </div>
                  </div>
                </SectionReveal>
              </Section>

              {/* PRODUCTS — the lines. */}
              <Section title={t(`${KEY}.sections.lines.title`)} description={t(`${KEY}.sections.lines.description`)}>
                <SectionReveal loading={revealing} delaySeconds={SECTION_REVEAL_STEP * 3} skeleton={<BodySkeleton rows={2} />}>
                  <div className="reveal-item flex flex-col gap-5">
                    {lines.fields.length === 0 && (
                      <p className="text-sm text-charcoal/45">{t(`${KEY}.lines.empty`)}</p>
                    )}
                    {lines.fields.map((row, index) => {
                      // Live per-line price: unit (rent/sale) and subtotal (unit × qty × billed days
                      // for a Día rental; once otherwise) — shown once a product is picked.
                      const lineProduct =
                        lineValues[index]?.productId != null
                          ? productsById.get(lineValues[index].productId)
                          : undefined;
                      const lineQty = parseLineQuantity(lineValues[index]?.quantity ?? '') ?? 0;
                      return (
                        <LineRow
                          key={row.id}
                          onRegister={(el) => {
                            if (el) lineRowRefs.current.set(row.id, el);
                            else lineRowRefs.current.delete(row.id);
                          }}
                        >
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,130px)]">
                              <CustomSelectForm<CreateOrderFormType>
                                id={`order-line-product-${index}`}
                                name={`lines.${index}.productId`}
                                label={t(`${KEY}.fields.lineProductLabel`)}
                                placeholderOption={t(`${KEY}.fields.lineProductPlaceholder`)}
                                options={optionsFor(lineValues[index]?.productId)}
                              />
                              <CustomInputForm<CreateOrderFormType>
                                id={`order-line-quantity-${index}`}
                                name={`lines.${index}.quantity`}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                step={1}
                                max={availableFor(lineValues[index]?.productId)}
                                instructions={availabilityHint(lineValues[index]?.productId)}
                                label={t(`${KEY}.fields.lineQuantityLabel`)}
                                aria-label={t(`${KEY}.fields.lineQuantityLabel`)}
                              />
                            </div>
                            <LineSubtotalNote product={lineProduct} quantity={lineQty} billedDays={billedDays} />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(row.id)}
                            aria-label={t(`${KEY}.actions.removeLine`)}
                            className="mt-1.5 grid size-9 shrink-0 cursor-pointer place-items-center rounded-chip text-charcoal/45 transition-[color,background-color,box-shadow] duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
                          >
                            <HiOutlineTrash aria-hidden className="size-4.5" />
                          </button>
                        </LineRow>
                      );
                    })}
                    <div className="self-start">
                      <Button
                        variant="soft"
                        color={SECONDARY_COLOR}
                        size="sm"
                        disabled={!canAddLine}
                        startIcon={<HiOutlinePlus className="size-4" />}
                        onClick={() =>
                          lines.append(
                            { productId: null as unknown as number, quantity: '', isRental: false },
                            { shouldFocus: false },
                          )
                        }
                      >
                        {t(`${KEY}.actions.addLine`)}
                      </Button>
                    </div>
                  </div>
                </SectionReveal>
              </Section>

              {/* DELIVERY snapshot — prefilled from the client, editable for one-off venues. */}
              <Section title={t(`${KEY}.sections.delivery.title`)} description={t(`${KEY}.sections.delivery.description`)}>
                <SectionReveal loading={revealing} delaySeconds={SECTION_REVEAL_STEP * 4} skeleton={<BodySkeleton rows={3} />}>
                  <div className="flex flex-col gap-5">
                    {/* Who HANDLES the delivery — the deliverable staff (Admin + Driver), defaulting
                        to the creating admin, so the order is never unassigned. */}
                    <div className="reveal-item">
                      <CustomSelectForm<CreateOrderFormType>
                        id="order-assigned-user"
                        name="assignedUserId"
                        label={t(`${KEY}.fields.assignToLabel`)}
                        placeholderOption={t(`${KEY}.fields.assignToPlaceholder`)}
                        options={(catalog?.assignableUsers ?? []).map((u) => ({
                          value: u.id,
                          label: `${u.name} · ${u.role}`,
                        }))}
                      />
                      <p className="mt-1 px-2 text-xs text-charcoal/45">{t(`${KEY}.fields.assignToHint`)}</p>
                    </div>
                    <div className="reveal-item">
                      <CustomInputForm<CreateOrderFormType>
                        id="order-delivery-name"
                        name="deliveryName"
                        type="text"
                        label={t(`${KEY}.fields.deliveryNameLabel`)}
                        placeholder={t(`${KEY}.fields.deliveryNamePlaceholder`)}
                        aria-label={t(`${KEY}.fields.deliveryNameLabel`)}
                      />
                    </div>
                    {selectedRegistry && selectedRegistry.contacts.length > 0 && (
                      <div className="reveal-item">
                        <CustomSelect
                          id="order-saved-contact"
                          optionalLabel
                          label={t(`${KEY}.fields.savedContactLabel`)}
                          placeholderOption={t(`${KEY}.fields.savedCustom`)}
                          value={savedContactId ?? ''}
                          onChange={(e) => pickSavedContact(e.target.value)}
                          options={selectedRegistry.contacts.map((c) => ({
                            value: c.id,
                            label: `${c.contactType.name}: ${c.value}`,
                          }))}
                        />
                      </div>
                    )}
                    {/* Contact channel (icon + keyboard) + the value — default from the client, editable. */}
                    <div className="reveal-item grid gap-5 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
                      <CustomSelectForm<CreateOrderFormType>
                        id="order-delivery-contact-type"
                        name="deliveryContactTypeId"
                        optionalLabel
                        label={t(`${KEY}.fields.deliveryContactTypeLabel`)}
                        placeholderOption={t(`${KEY}.fields.deliveryContactTypePlaceholder`)}
                        options={(catalog?.contactTypes ?? []).map((c) => ({ value: c.id, label: c.name }))}
                      />
                      <CustomInputForm<CreateOrderFormType>
                        id="order-delivery-contact"
                        name="deliveryContact"
                        type="text"
                        inputMode={CHANNEL_INPUT_MODE[contactKind]}
                        icon={<ContactChannelIcon kind={contactKind} />}
                        label={t(`${KEY}.fields.deliveryContactLabel`)}
                        placeholder={t(`${KEY}.fields.deliveryContactPlaceholder`)}
                        aria-label={t(`${KEY}.fields.deliveryContactLabel`)}
                      />
                    </div>
                    {selectedRegistry && selectedRegistry.addresses.length > 0 && (
                      <div className="reveal-item">
                        <CustomSelect
                          id="order-saved-address"
                          optionalLabel
                          label={t(`${KEY}.fields.savedAddressLabel`)}
                          placeholderOption={t(`${KEY}.fields.savedCustom`)}
                          value={savedAddressId ?? ''}
                          onChange={(e) => pickSavedAddress(e.target.value)}
                          options={selectedRegistry.addresses.map((a) => ({
                            value: a.id,
                            label: a.address,
                          }))}
                        />
                      </div>
                    )}
                    <div className="reveal-item">
                      <CustomTextareaForm<CreateOrderFormType>
                        id="order-delivery-address"
                        name="deliveryAddress"
                        autoGrow
                        label={t(`${KEY}.fields.deliveryAddressLabel`)}
                        placeholder={t(`${KEY}.fields.deliveryAddressPlaceholder`)}
                        aria-label={t(`${KEY}.fields.deliveryAddressLabel`)}
                      />
                    </div>
                    {/* Delivery zone (for a one-off venue) — suggests the zone's fee, editable below. */}
                    <div className="reveal-item">
                      <CustomSelect
                        id="order-delivery-zone"
                        optionalLabel
                        label={t(`${KEY}.fields.deliveryZoneLabel`)}
                        placeholderOption={t(`${KEY}.fields.deliveryZonePlaceholder`)}
                        value={deliveryZoneId ?? ''}
                        onChange={(e) => pickDeliveryZone(e.target.value)}
                        options={(catalog?.zones ?? []).map((z) => ({ value: z.id, label: z.name }))}
                      />
                      <p className="mt-1 px-2 text-xs text-charcoal/45">{t(`${KEY}.fields.deliveryZoneHint`)}</p>
                    </div>
                    <div className="reveal-item">
                      <CustomTextareaForm<CreateOrderFormType>
                        id="order-comment"
                        name="comment"
                        autoGrow
                        optionalLabel
                        label={t(`${KEY}.fields.commentLabel`)}
                        placeholder={t(`${KEY}.fields.commentPlaceholder`)}
                        aria-label={t(`${KEY}.fields.commentLabel`)}
                      />
                    </div>
                  </div>
                </SectionReveal>
              </Section>

              {/* MONEY — the admin-set delivery fee + optional deposit, and the live estimate. */}
              <Section title={t(`${KEY}.sections.money.title`)} description={t(`${KEY}.sections.money.description`)}>
                <SectionReveal loading={revealing} delaySeconds={SECTION_REVEAL_STEP * 5} skeleton={<BodySkeleton rows={2} />}>
                  <div className="flex flex-col gap-5">
                    <div className="reveal-item grid gap-5 sm:grid-cols-2">
                      <CustomInputForm<CreateOrderFormType>
                        id="order-delivery-amount"
                        name="deliveryAmount"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        optionalLabel
                        label={t(`${KEY}.fields.deliveryAmountLabel`)}
                        placeholder={t(`${KEY}.fields.moneyPlaceholder`)}
                        aria-label={t(`${KEY}.fields.deliveryAmountLabel`)}
                        instructions={t(`${KEY}.fields.deliveryAmountHint`)}
                      />
                      <CustomInputForm<CreateOrderFormType>
                        id="order-deposit-amount"
                        name="depositAmount"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        optionalLabel
                        label={t(`${KEY}.fields.depositAmountLabel`)}
                        placeholder={t(`${KEY}.fields.moneyPlaceholder`)}
                        aria-label={t(`${KEY}.fields.depositAmountLabel`)}
                      />
                    </div>
                    <div className="reveal-item">
                      <CustomSelectForm<CreateOrderFormType>
                        id="order-payment-method"
                        name="paymentMethodId"
                        optionalLabel
                        label={t(`${KEY}.fields.paymentMethodLabel`)}
                        placeholderOption={t(`${KEY}.fields.paymentMethodPlaceholder`)}
                        options={(catalog?.paymentMethods ?? []).map((m) => ({ value: m.id, label: m.name }))}
                      />
                    </div>
                    {/* Breakdown: products subtotal + delivery fee → total (all estimated). */}
                    <div className="reveal-item flex flex-col gap-2 rounded-control bg-charcoal/[0.03] px-4 py-3">
                      <div className="flex items-center justify-between text-sm text-charcoal/60">
                        <span>{t(`${KEY}.estimate.productsSubtotal`)}</span>
                        <span className="tabular-nums">{formatMoney(currencySymbol, linesSubtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm text-charcoal/60">
                        <span>{t(`${KEY}.estimate.deliveryFee`)}</span>
                        <span className="tabular-nums">{formatMoney(currencySymbol, deliveryFee)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between border-t border-charcoal/10 pt-2">
                        <span className="text-sm font-medium text-charcoal/70">{t(`${KEY}.estimate.label`)}</span>
                        <span aria-live="polite" className="text-lg font-bold tabular-nums text-charcoal">
                          {formatMoney(currencySymbol, estimate)}
                        </span>
                      </div>
                    </div>
                    <p className="reveal-item text-xs text-charcoal/45">{t(`${KEY}.estimate.note`)}</p>
                  </div>
                </SectionReveal>
              </Section>

              <div className="reveal-block flex flex-col">
                <FormError id="create-order-error" message={formError} />
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <Button
                    variant="soft"
                    color={SECONDARY_COLOR}
                    fullWidth
                    disabled={isSaving}
                    onClick={() =>
                      panelNavigate(isEdit ? `/panel/pedidos/${order.id}` : '/panel/pedidos')
                    }
                    className="sm:w-auto"
                  >
                    {t(`${KEY}.actions.cancel`)}
                  </Button>
                  <Button
                    type="submit"
                    form={FORM_ID}
                    color={SECONDARY_COLOR}
                    fullWidth
                    disabled={!dataReady}
                    loading={isSaving}
                    className="sm:w-auto"
                  >
                    {t(isEdit ? `${EKEY}.actions.submit` : `${KEY}.actions.submit`)}
                  </Button>
                </div>
              </div>
            </form>
          </FormProvider>
        </RequiredPatternsContext.Provider>
      )}

      <ClientRegistryModal
        open={registryModalOpen}
        onClose={() => setRegistryModalOpen(false)}
        onCreated={onRegistryCreated}
        contactTypes={catalog?.contactTypes ?? []}
        zones={catalog?.zones ?? []}
        paymentMethods={catalog?.paymentMethods ?? []}
      />
    </div>
  );
};

export default OrderForm;
