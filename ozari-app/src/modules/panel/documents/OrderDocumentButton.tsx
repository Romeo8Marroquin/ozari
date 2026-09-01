import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineDocumentArrowDown } from 'react-icons/hi2';
import Button from '@components/Button';
import { notify } from '@components/notifications/notify';
import { downloadDocument } from './downloadDocument';
import { fromOrderDetail } from './documentModel';
import { DOCUMENT_DATE, DOCUMENT_DATE_TIME, documentMoney } from './documentFormats';
import { useDocumentCopy, useDocumentLetterhead } from './useDocumentVocabulary';
import type { OrderDetail } from '../orders/order.types';

const KEY = 'modules.panel.documents';
const SECONDARY_COLOR = '#262626';

interface OrderDocumentButtonProps {
  order: OrderDetail;
}

/**
 * "Descargar comprobante" — the order detail's document action (EPIC-2-DOCUMENTS Phase 1).
 *
 * **Offered at EVERY step except a cancelled order** (owner decision 2026-08-05). The document is
 * not a receipt that waits for payment: it is how the admin tells a client what they owe, so an
 * order still `En ruta` is exactly when it is most useful. Once `paidAt` is set the same page comes
 * back carrying the PAGADO mark and a balance of zero — one document, two meanings, which is why it
 * is not gated on payment either. A CANCELLED order produces nothing: there is no agreement left to
 * document, and a cancelled order's figures handed to a client would read as a live bill.
 *
 * Its sibling is `QuoteDocumentButton` on the order FORM — same template, same vocabulary, unsaved
 * figures.
 */
const OrderDocumentButton: React.FC<OrderDocumentButtonProps> = ({ order }) => {
  const { t } = useTranslation();
  const copy = useDocumentCopy('receipt');
  const letterhead = useDocumentLetterhead();
  const [busy, setBusy] = useState(false);

  // Cancelled ⇒ no document at all. Deliberately renders NOTHING rather than a disabled button: a
  // greyed control invites a hunt for the condition that would enable it, and there isn't one.
  if (order.cancelledAt !== undefined) return null;

  const download = (): void => {
    setBusy(true);
    void downloadDocument({
      model: fromOrderDetail(order, letterhead, new Date()),
      copy,
      money: documentMoney(order.currency.symbol),
      date: (value) => DOCUMENT_DATE.format(value),
      dateTime: (value) => DOCUMENT_DATE_TIME.format(value),
    })
      // A failure here is ambient — nothing on the page changed, the file simply did not arrive —
      // so it toasts rather than taking over the screen. The most likely cause by far is the lazy
      // chunk failing to load on a bad connection, which a retry fixes.
      .catch(() => notify.error(t(`${KEY}.errors.failed`)))
      .finally(() => setBusy(false));
  };

  return (
    <Button
      variant="soft"
      size="sm"
      color={SECONDARY_COLOR}
      loading={busy}
      startIcon={<HiOutlineDocumentArrowDown className="size-4" />}
      onClick={download}
    >
      {t(`${KEY}.actions.download`)}
    </Button>
  );
};

export default OrderDocumentButton;
