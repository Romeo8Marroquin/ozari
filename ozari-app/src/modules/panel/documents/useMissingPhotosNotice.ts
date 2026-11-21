import { useTranslation } from 'react-i18next';
import { notify } from '@components/notifications/notify';
import type { DocumentDownloadResult } from './downloadDocument';

const KEY = 'modules.panel.documents';

/**
 * What every document button does with a FINISHED download: when some photos could not be embedded
 * (`documentImages.ts` drops them rather than fail the file), say so once — the file arrived, so it
 * is a warning, not an error, and it names the remedy (download again). Silence when nothing is
 * missing, which is the normal case.
 *
 * One hook for every document, so a new one inherits the same notice by calling it.
 */
export function useMissingPhotosNotice(): (result: DocumentDownloadResult) => void {
  const { t } = useTranslation();
  return ({ missingPhotos }) => {
    if (missingPhotos > 0) {
      notify.warning(t(`${KEY}.warnings.missingPhotos`, { count: missingPhotos }));
    }
  };
}
