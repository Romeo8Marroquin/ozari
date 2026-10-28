import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineDocumentArrowDown } from 'react-icons/hi2';
import Button from '@components/Button';
import { notify } from '@components/notifications/notify';
import { downloadDamageReport } from './downloadDocument';
import { fromDamageReport } from './documentModel';
import { DOCUMENT_DATE, DOCUMENT_DATE_TIME, documentMoney } from './documentFormats';
import { useDamageReportCopy, useDocumentLetterhead } from './useDocumentVocabulary';
import type { OrderDepositSettlement, OrderDetail } from '../orders/order.types';

const KEY = 'modules.panel.documents';
const SECONDARY_COLOR = '#262626';

export interface DamageReportButtonProps {
  order: OrderDetail;
  /** The settlement the admin entered — the saved one, or the report form's current values. */
  settlement: OrderDepositSettlement;
}

/**
 * "Descargar reporte de daños" — the client-facing damage statement (EPIC-2-DOCUMENTS §2c).
 *
 * The report is generated from what the admin entered, saved or not yet saved, and it is THE damage
 * report either way (owner, 2026-10-27): no draft mark, no draft file name, issued at the download.
 *
 * The figures are the settlement's own, copied verbatim, and the outcome is the order squared with
 * them (`fromDamageReport`); this component only gathers the letterhead and the vocabulary and
 * hands them over, exactly like `OrderDocumentButton`.
 */
const DamageReportButton: React.FC<DamageReportButtonProps> = ({ order, settlement }) => {
  const { t } = useTranslation();
  const copy = useDamageReportCopy();
  const letterhead = useDocumentLetterhead();
  const [busy, setBusy] = useState(false);

  const download = (): void => {
    setBusy(true);
    void downloadDamageReport({
      model: fromDamageReport(order, settlement, letterhead, new Date()),
      copy,
      money: documentMoney(order.currency.symbol),
      date: (value) => DOCUMENT_DATE.format(value),
      dateTime: (value) => DOCUMENT_DATE_TIME.format(value),
    })
      // Ambient, like the comprobante's: nothing on the page changed, the file simply did not
      // arrive — most likely the lazy chunk on a bad connection, which a retry fixes.
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
      {t(`${KEY}.actions.damageReport`)}
    </Button>
  );
};

export default DamageReportButton;
