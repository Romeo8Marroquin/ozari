import { embedDamageReportImages, embedDocumentImages } from './documentImages';
import { damageReportFileName, documentFileName } from './documentModel';
import type { DamageReportModel, DocumentModel } from './documentModel';
import type { DamageReportCopy, DocumentCopy } from './OrderDocument';

/**
 * Turn a {@link DocumentModel} into a downloaded PDF.
 *
 * **The renderer is imported LAZILY, on the click** — the same treatment `LocationPicker` gets, and
 * for the same reason: `@react-pdf/renderer` is a layout engine plus a PDF writer, and an admin who
 * never asks for a document must not pay for it on every panel load. The import is what makes the
 * button's brief spinner honest — it is genuinely fetching the machinery.
 *
 * Everything that DECIDES anything lives here or in `documentModel`; the template is pure layout.
 */
export interface DownloadDocumentInput {
  model: DocumentModel;
  copy: DocumentCopy;
  money: (amount: number) => string;
  date: (value: Date) => string;
  dateTime: (value: Date) => string;
}

/**
 * Hand the finished bytes to the browser.
 *
 * An object URL + a synthetic anchor rather than opening a tab: a tab is blocked by popup blockers
 * when the click and the open are separated by an await (which they always are here — the renderer
 * has to load first), and it gives the file whatever name the URL happens to have. The URL is
 * revoked afterwards, because an un-revoked blob pins its bytes in memory for the life of the tab —
 * and an admin generating documents all afternoon is exactly the person who would notice.
 *
 * ⚠️ **The revoke is DEFERRED, and that is a mobile fix** (2026-08-26). Revoking in the same task as
 * `click()` races the browser's own read of the blob: Chrome has already taken it, but Firefox
 * (desktop and Android) and older Safari start the download asynchronously and find the URL gone —
 * the tap produces nothing at all, with no error to explain it. A timeout hands the bytes over
 * first and still frees them; the delay is long enough for any browser to have claimed the blob and
 * far too short to accumulate memory across an afternoon of documents.
 */
const REVOKE_DELAY_MS = 60_000;

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  // `rel="noopener"` and an off-screen anchor: some mobile browsers ignore `download` for a blob and
  // navigate to it instead, and a navigation that can reach `window.opener` is one worth closing off.
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** Both halves in ONE dynamic import boundary: the template is useless without the renderer, so
 *  splitting them would only cost a second round trip on the same click. Every document shares
 *  the chunk — the damage report is a second component of the same template file. */
const loadRenderer = () =>
  Promise.all([import('@react-pdf/renderer'), import('./OrderDocument')]);

/**
 * The row photos are fetched WHILE the renderer chunk downloads — two waits overlapped into one —
 * and arrive embedded (or dropped, when one cannot be had: `documentImages.ts`). The template never
 * sees a network URL, so a photo can never stall or fail the file.
 */
export async function downloadDocument(input: DownloadDocumentInput): Promise<void> {
  const [[{ pdf }, { default: OrderDocument }], model] = await Promise.all([
    loadRenderer(),
    embedDocumentImages(input.model),
  ]);
  const blob = await pdf(
    <OrderDocument
      model={model}
      copy={input.copy}
      money={input.money}
      date={input.date}
      dateTime={input.dateTime}
    />,
  ).toBlob();
  saveBlob(blob, documentFileName(model));
}

export interface DownloadDamageReportInput extends Omit<DownloadDocumentInput, 'model' | 'copy'> {
  model: DamageReportModel;
  copy: DamageReportCopy;
}

/** The damage report (EPIC-2-DOCUMENTS §2c) — same machinery, same lazy chunk, its own file name. */
export async function downloadDamageReport(input: DownloadDamageReportInput): Promise<void> {
  const [[{ pdf }, { DamageReportDocument }], model] = await Promise.all([
    loadRenderer(),
    embedDamageReportImages(input.model),
  ]);
  const blob = await pdf(
    <DamageReportDocument
      model={model}
      copy={input.copy}
      money={input.money}
      date={input.date}
      dateTime={input.dateTime}
    />,
  ).toBlob();
  saveBlob(blob, damageReportFileName(model));
}
