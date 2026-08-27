import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { HiOutlineDocumentArrowDown } from 'react-icons/hi2';
import Button from '@components/Button';
import { notify } from '@components/notifications/notify';
import { downloadDocument } from './downloadDocument';
import { fromOrderForm } from './documentModel';
import { DOCUMENT_DATE, DOCUMENT_DATE_TIME, documentMoney } from './documentFormats';
import { useDocumentCopy, useDocumentLetterhead } from './useDocumentVocabulary';
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
 * **The valid-form gate is a CHECK ON CLICK, not a disabled button** (owner decision #2, implemented
 * the way this form already behaves). "No document from an incomplete form" is honoured either way,
 * but a greyed control on a twenty-field form is a puzzle: it cannot say WHICH field is missing, and
 * the admin is left hunting. Clicking runs the same resolver that guards submit, so an incomplete
 * form lights up its own field errors — the answer, rather than the absence of one. It also matches
 * the submit button beside it, which is enabled and validates on press.
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
  const { trigger, getValues } = useFormContext<CreateOrderFormType>();
  const [busy, setBusy] = useState(false);

  const download = async (): Promise<void> => {
    // The SAME resolver that guards submit — including the live availability caps layered onto it,
    // since a quote promising goods we cannot supply is worse than no quote.
    if (!(await trigger())) {
      notify.warning(t(`${KEY}.errors.incompleteForm`));
      return;
    }
    const values = getValues();
    const model = fromOrderForm(
      {
        values,
        productsById,
        // The registry client is who the quote is ADDRESSED to; the delivery name is who receives
        // it. Prefer the former and fall back to the latter, which the schema guarantees is present
        // — a walk-in quoted before they exist as a client still gets a document with a name on it.
        clientName:
          registries.find((registry) => registry.id === values.clientRegistryId)?.name ??
          values.deliveryName,
        eventTypeName: eventTypes.find((type) => type.id === values.eventTypeId)?.name ?? '',
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
