import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { HiOutlineDocumentArrowDown } from 'react-icons/hi2';
import Button from '@components/Button';
import { notify } from '@components/notifications/notify';
import { downloadDocument } from './downloadDocument';
import { fromOrderForm } from './documentModel';
import { quoteFields } from './quoteGate';
import { DOCUMENT_DATE, DOCUMENT_DATE_TIME, documentMoney } from './documentFormats';
import { useDocumentCopy, useDocumentLetterhead } from './useDocumentVocabulary';
import { useMissingPhotosNotice } from './useMissingPhotosNotice';
import type { CatalogOption, ClientRegistry } from '../orders/order.types';
import type { CreateOrderFormType } from '../orders/SchemaCreateOrder';
import type { Product } from '../products/product.types';

const KEY = 'modules.panel.documents';
const SECONDARY_COLOR = '#262626';

interface QuoteDocumentButtonProps {
  productsById: ReadonlyMap<number, Product>;
  /** The two lookups that turn the form's ids into the names a document prints. Passed as DATA
   *  rather than as a resolver callback: how a quote names its subject is this component's business,
   *  and a callback would leave that rule stranded in the form, uncovered and untestable. */
  registries: readonly ClientRegistry[];
  eventTypes: readonly CatalogOption[];
  disabled?: boolean;
}

/**
 * "Descargar cotización" — the order FORM's document action (EPIC-2-DOCUMENTS Phase 2).
 *
 * The same template and the same vocabulary as the comprobante, from **unsaved** values: quoting on
 * the phone before the client commits is the entire point, so this deliberately does not require
 * saving. What it produces says what it is on its face — no order number, a validity date, and the
 * "sujeta a cambios" notice — because a proposal that looks like a receipt is a document a client
 * can hold you to.
 *
 * **One product is enough** (owner, 2026-11-19 — superseding "no document from an incomplete form").
 * A quote is usually the FIRST question ("¿cuánto por 50 sillas?"), asked before there is a client,
 * a venue or a date, so nothing the ORDER requires is required here: what has not been given is left
 * off the page (`fromOrderForm` + the template's known-facts rule).
 *
 * What the gate still guards is what gets PRINTED: the lines (at least one, each a real product with
 * a valid quantity, its variation and the live availability caps — a quote promising goods we cannot
 * supply is worse than no quote), every money field, the billed days and the discount (with its
 * ceiling), and any optional text or date the admin DID fill in. It is still a check on click, never
 * a disabled button, and it runs the same resolver as submit — on exactly those fields, so a missing
 * client or date stays quiet instead of lighting up as an error the quote does not have.
 */
const QuoteDocumentButton: React.FC<QuoteDocumentButtonProps> = ({
  productsById,
  registries,
  eventTypes,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const copy = useDocumentCopy('quote');
  const letterhead = useDocumentLetterhead();
  const announceMissingPhotos = useMissingPhotosNotice();
  const { trigger, getValues } = useFormContext<CreateOrderFormType>();
  const [busy, setBusy] = useState(false);

  const download = async (): Promise<void> => {
    // The SAME resolver that guards submit — including the live availability caps layered onto it —
    // on the fields the quote PRINTS (see `quoteFields`).
    if (!(await trigger(quoteFields(getValues())))) {
      notify.warning(t(`${KEY}.errors.incompleteQuote`));
      return;
    }
    const values = getValues();
    const model = fromOrderForm(
      {
        values,
        productsById,
        // The registry client is who the quote is ADDRESSED to; the delivery name is who receives
        // it. Prefer the former and fall back to the latter — and to nobody yet: a quote asked for
        // before a name was given simply has no client card.
        clientName:
          registries.find((registry) => registry.id === values.clientRegistryId)?.name ??
          values.deliveryName,
        eventTypeName: eventTypes.find((type) => type.id === values.eventTypeId)?.name,
      },
      letterhead,
      new Date(),
    );
    if (model === undefined) {
      // Defence in depth: the resolver has already passed, so this is a product that vanished from
      // the cache mid-edit rather than anything the admin typed. Ambient, like any other failure to
      // produce the file.
      notify.error(t(`${KEY}.errors.failed`));
      return;
    }

    setBusy(true);
    await downloadDocument({
      model,
      copy,
      money: documentMoney(model.currencySymbol),
      date: (value) => DOCUMENT_DATE.format(value),
      dateTime: (value) => DOCUMENT_DATE_TIME.format(value),
    })
      .then(announceMissingPhotos)
      .catch(() => notify.error(t(`${KEY}.errors.failed`)))
      .finally(() => setBusy(false));
  };

  return (
    <Button
      variant="soft"
      color={SECONDARY_COLOR}
      fullWidth
      disabled={disabled}
      loading={busy}
      startIcon={<HiOutlineDocumentArrowDown className="size-4" />}
      onClick={() => void download()}
      className="sm:w-auto"
    >
      {t(`${KEY}.actions.quote`)}
    </Button>
  );
};

export default QuoteDocumentButton;
