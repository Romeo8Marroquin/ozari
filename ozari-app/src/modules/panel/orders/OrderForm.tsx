import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form';
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
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { getStatus, toFormError } from '@utils/apiError';
import { detailRowIn, detailRowOut, SECTION_REVEAL_STEP, staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import PreferencesCta from '../PreferencesCta';
import type { Product } from '../products/product.types';
import ProductsStatus from '../products/ProductsStatus';
import SectionReveal from '../products/SectionReveal';
import ClientRegistryModal from './ClientRegistryModal';
import { CHANNEL_INPUT_MODE, contactChannelKind } from '@constants/Regex';
import ContactChannelIcon from './ContactChannelIcon';
import type { ClientRegistry, OrderStockConflictItem } from './order.types';
import {
  billedDaysFromStrings,
  estimateLineSubtotal,
  estimateOrderTotal,
  formatMoney,
  isRentalProduct,
  lineUnitPrice,
} from './orderEstimate';
import {
  createOrderDefaultValues,
  createOrderRequiredPatterns,
  createOrderSchema,
  parseDateTime,
  parseLineQuantity,
  parseMoney,
  toCreateOrderBody,
  type CreateOrderFormType,
} from './SchemaCreateOrder';
import { useClientRegistries } from './useClientRegistries';
import { useCreateOrder } from './useCreateOrder';
import { useOrderAvailability } from './useOrderAvailability';
import { useOrderProducts } from './useOrderProducts';
import { useOrdersCatalog } from './useOrdersCatalog';

const FORM_ID = 'create-order-form';
const KEY = 'modules.panel.orders.create';
const SECONDARY_COLOR = '#262626';

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
 * Step zero is the MODE fork (rent / buy / both), which filters the product picker and, together
 * with which lines are rentals, decides whether a pickup exists (Q-A). Selecting a client registry
 * prefills the delivery snapshots (editable — parties rarely happen at the client's home); a "new
 * client" button opens {@link ClientRegistryModal} inline. Pricing is derived SERVER-SIDE; the form
 * shows an on-brand ESTIMATE (mirrors the backend formula) so the admin can quote on the phone.
 */
const OrderForm: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const queryClient = useQueryClient();
  const catalogQuery = useOrdersCatalog();
  const productsQuery = useOrderProducts();
  const registriesQuery = useClientRegistries();
  const { createOrder, isPending: isCreating } = useCreateOrder();
  const { checkAvailability } = useOrderAvailability();

  const [registryModalOpen, setRegistryModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  // Per-product takeable amounts for the current window (null = a rental with no pickup yet). Drives
  // the picker annotations + the line reconciliation; empty until a valid delivery date is set.
  const [availability, setAvailability] = useState<Map<number, number | null>>(new Map());

  const catalog = catalogQuery.data;
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const registries = useMemo(() => registriesQuery.data ?? [], [registriesQuery.data]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const methods = useForm<CreateOrderFormType>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: createOrderDefaultValues,
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
  const previousRegistryId = useRef<number | null>(null);
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
      const adjusted: string[] = [];
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
          adjusted.push(`${name} (${available})`);
        }
      }
      if (adjusted.length === 0 && removed.length === 0) return;
      const parts: string[] = [];
      if (adjusted.length > 0) parts.push(t(`${KEY}.availability.adjustedList`, { items: adjusted.join(', ') }));
      if (removed.length > 0) parts.push(t(`${KEY}.availability.removedList`, { items: removed.join(', ') }));
      notify.warning(parts.join(' '), { title: t(`${KEY}.availability.reconciledTitle`) });
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
    if (isCreating) return;
    setFormError(undefined);
    createOrder(toCreateOrderBody(data), {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDERS] });
        notify.success(t(`${KEY}.successToast`), { title: t(`${KEY}.successTitle`) });
        panelNavigate('/panel/pedidos');
      },
      onError: (error) => {
        // A stock 409 carries structured conflicts — surface them per-line AND in the banner.
        if (axios.isAxiosError(error) && getStatus(error) === 409) {
          const conflicts = (error.response?.data as { data?: { conflicts?: OrderStockConflictItem[] } })
            ?.data?.conflicts;
          if (conflicts?.length) applyStockConflicts(conflicts);
        }
        const { inline, toast } = toFormError(error, t(`${KEY}.errors.submitFallback`));
        if (inline) setFormError(inline);
        if (toast) notify.error(toast);
      },
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
  // rental line ⇒ a pickup is required); no upfront mode fork. Already-picked products are hidden.
  // Once a window is set, each option is annotated with its takeable amount for that window.
  const availabilityTag = (productId: number): string => {
    const amount = availability.get(productId);
    if (amount == null) return '';
    return amount === 0
      ? ` · ${t(`${KEY}.availability.soldOut`)}`
      : ` · ${t(`${KEY}.availability.count`, { count: amount })}`;
  };
  const optionsFor = (currentId: number | null | undefined) =>
    products
      .filter((product) => product.id === currentId || !usedProductIds.has(product.id))
      .map((product) => ({ value: product.id, label: product.name + availabilityTag(product.id) }));
  const canAddLine = lines.fields.length < products.length;
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
                    disabled={isCreating}
                    onClick={() => panelNavigate('/panel/pedidos')}
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
                    loading={isCreating}
                    className="sm:w-auto"
                  >
                    {t(`${KEY}.actions.submit`)}
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
