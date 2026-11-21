import { isAxiosError } from 'axios';
import { api } from '@api/client';
import type {
  DamageReportModel,
  DocumentLineImage,
  DocumentModel,
} from './documentModel';

/**
 * The row photos, made SAFE to print (EPIC-2-DOCUMENTS §2d).
 *
 * A model carries each line's photo as the catalog's URL. Handing that URL to react-pdf's `<Image>`
 * is not an option, for three reasons that each fail SILENTLY:
 *
 * 1. **Formats.** react-pdf embeds PNG and JPEG only, and the gallery accepts WebP and AVIF too — a
 *    WebP photo would simply print as an empty box.
 * 2. **No timeout.** react-pdf fetches every image before it lays out a single page, with no time
 *    limit: one slow or hung request and the button spins forever.
 * 3. **Failures are swallowed, not reported** (a `console.warn`), so there is nothing to branch on.
 *
 * So every photo is fetched HERE first — once per distinct URL, in parallel, each under its own
 * timeout — decoded by the BROWSER (which reads every format the gallery accepts), downscaled to
 * thumbnail size and re-encoded as a `data:` URI the template embeds without touching the network.
 * The downloaded file therefore CONTAINS its photos: it never fetches anything again.
 *
 * **Through our own API, never the public assets host** (2026-11-20, §2d #39). The bytes come from
 * `GET /documents/image`, which reads the object over the storage API. Fetched from the assets host
 * instead, a photo needed the edge's CORS header — and the edge cache serves whatever copy it took
 * first, so a photo first loaded by a catalog `<img>` (a request that asks for no CORS header) came
 * back without one and was silently dropped: documents printed with no photos at all. Same origin
 * as every other call, there is nothing left to line up.
 *
 * A photo that still cannot be had (deleted, offline, a format this browser cannot decode, the
 * timeout) is dropped from its row, and the row prints exactly as a row with no photo — **a picture
 * never costs the document** — but it is COUNTED (`missingPhotos`), so the admin is told instead of
 * finding out from the client.
 *
 * Every document reads its photos through {@link loadRowPhotos}; a new document gets all of the
 * above by handing it its lines.
 */

/** The endpoint that serves one of the app's own photos as bytes. */
export const DOCUMENT_IMAGE_ENDPOINT = '/documents/image';

/** How long ONE attempt at one photo may take. Above the server's own storage deadline (6s,
 *  `appConfig.storage.readTimeoutMs`), so a slow store answers as a retryable 504 first. */
export const DOCUMENT_IMAGE_TIMEOUT_MS = 8_000;

/** The pause before the single retry of a photo whose first attempt failed TRANSIENTLY. */
export const DOCUMENT_IMAGE_RETRY_DELAY_MS = 500;

/**
 * How many photos are in flight at once. Each one is a full-size original (up to 5 MB) the server
 * buffers before answering, so thirty at once would be thirty buffers on one small instance and
 * thirty downloads on the admin's phone connection competing for the same pipe. Four keeps the
 * pipe busy without either.
 */
export const DOCUMENT_IMAGE_CONCURRENCY = 4;

/**
 * The whole photo phase's budget. A document is something the admin is WAITING on with a spinner,
 * so a degraded network may cost it some photos but never an open-ended wait: a photo not yet
 * started when the budget runs out is skipped (and counted), and each attempt is clipped to what is
 * left of it.
 */
export const DOCUMENT_PHOTOS_BUDGET_MS = 20_000;

/** Below this much budget a retry is not worth starting — it could not finish anyway. */
const MIN_ATTEMPT_MS = 1_000;

/**
 * The longest side of the embedded raster, in pixels. The box prints at 18pt (`THUMB_SIZE`), so this
 * is ~9px per point — sharp under a zoom and on a printer, and a few KB per photo instead of the
 * full-size original multiplied by every row that shows it.
 */
export const DOCUMENT_IMAGE_MAX_PX = 160;

const JPEG_QUALITY = 0.85;

/** Does this raster have no transparent pixel? Then it can travel as a (much smaller) JPEG. */
function isOpaque(pixels: Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 255) return false;
  }
  return true;
}

/**
 * A fetched photo → a small `data:` URI react-pdf can embed. JPEG when the photo is opaque; PNG when
 * it has transparency (a cut-out product on a transparent background), because a JPEG would paint
 * that background as a white box on the table's tinted rows.
 */
async function toThumbnail(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, DOCUMENT_IMAGE_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No 2D canvas');
    context.drawImage(bitmap, 0, 0, width, height);
    return isOpaque(context.getImageData(0, 0, width, height).data)
      ? canvas.toDataURL('image/jpeg', JPEG_QUALITY)
      : canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

/**
 * Worth ONE more try? Only a failure that says nothing about the photo itself: no answer at all
 * (a dropped connection, the attempt's timeout), a 408/429, or a 5xx (the store was slow — the
 * server's 504 — or the edge hiccupped). A 400/403/404/422 is an answer about THIS photo (not ours,
 * gone, not an image), and asking again would only get it again. A 401 never reaches here as such:
 * the client has already refreshed and replayed it.
 */
function isRetryable(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One request for one photo's bytes. Through the app's API client, so it carries the session (and
 * survives a token refresh mid-document like any other call); `skipErrorNotification` because a
 * photo that cannot be had is reported ONCE, as a count, by the caller — never as a toast per
 * photo; and `confirmOutage` because one slow photo is not proof the backend is down, so it may
 * only ASK the health probe before the full-screen outage overlay is raised.
 */
async function fetchPhoto(url: string, timeoutMs: number): Promise<Blob> {
  const response = await api.get<Blob>(DOCUMENT_IMAGE_ENDPOINT, {
    params: { url },
    responseType: 'blob',
    timeout: timeoutMs,
    skipErrorNotification: true,
    confirmOutage: true,
  });
  return response.data;
}

/**
 * ONE photo, or `undefined` — never a rejection. One attempt, plus a single retry after a short
 * pause when the first failed transiently ({@link isRetryable}); each attempt is clipped to what is
 * left before `deadline`, and a retry that could not finish in time is not started. A blob the
 * browser cannot decode (an unsupported format, or something that is not an image at all) is never
 * retried: the bytes would be the same.
 */
export async function loadDocumentImage(
  url: string,
  deadline: number = Date.now() + DOCUMENT_PHOTOS_BUDGET_MS,
): Promise<string | undefined> {
  const remaining = (): number => Math.min(DOCUMENT_IMAGE_TIMEOUT_MS, deadline - Date.now());
  let blob: Blob;
  try {
    blob = await fetchPhoto(url, remaining());
  } catch (error) {
    if (!isRetryable(error) || remaining() < DOCUMENT_IMAGE_RETRY_DELAY_MS + MIN_ATTEMPT_MS) {
      return undefined;
    }
    await pause(DOCUMENT_IMAGE_RETRY_DELAY_MS);
    try {
      blob = await fetchPhoto(url, remaining());
    } catch {
      return undefined;
    }
  }
  try {
    return await toThumbnail(blob);
  } catch {
    return undefined;
  }
}

/** `fn` over `items`, at most `limit` at a time, results in input order. */
async function mapPooled<Item, Result>(
  items: readonly Item[],
  limit: number,
  fn: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    const index = next;
    next += 1;
    if (index >= items.length) return;
    results[index] = await fn(items[index] as Item);
    return worker();
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Every distinct photo URL the rows reference — each fetched once, however many rows show it. */
function distinctUrls(lines: readonly DocumentLineImage[]): string[] {
  return [
    ...new Set(lines.flatMap((line) => (line.imageUrl === undefined ? [] : [line.imageUrl]))),
  ];
}

/** The photos a document's rows reference, loaded and ready to embed. */
export interface RowPhotos {
  /** A line with its photo swapped for the embeddable copy — or WITHOUT a photo when none was had. */
  embed: <Line extends DocumentLineImage>(line: Line) => Line;
  /** How many DISTINCT photos were embedded. */
  embedded: number;
  /** How many DISTINCT photos could not be had (their rows print without one). */
  missing: number;
}

/** A line with no photo at all — what a row prints as when its photo could not be had. */
function withoutPhoto<Line extends DocumentLineImage>(line: Line): Line {
  if (line.imageUrl === undefined) return line;
  const rest = { ...line };
  delete rest.imageUrl;
  return rest;
}

/**
 * Load every photo the given rows reference — the ONE entry point every document uses, so a new
 * document inherits all of this by passing its lines:
 *
 * - **Offline:** nothing is attempted (every attempt would only wait out its timeout); the document
 *   still renders, with every photo counted as missing.
 * - **Pooled:** at most {@link DOCUMENT_IMAGE_CONCURRENCY} in flight.
 * - **Budgeted:** a photo not started within {@link DOCUMENT_PHOTOS_BUDGET_MS} is skipped.
 */
export async function loadRowPhotos(lines: readonly DocumentLineImage[]): Promise<RowPhotos> {
  const urls = distinctUrls(lines);
  const deadline = Date.now() + DOCUMENT_PHOTOS_BUDGET_MS;
  const loaded = navigator.onLine
    ? await mapPooled(urls, DOCUMENT_IMAGE_CONCURRENCY, async (url) =>
        Date.now() < deadline ? loadDocumentImage(url, deadline) : undefined,
      )
    : [];
  const images = new Map(
    urls.flatMap((url, index) => {
      const dataUri = loaded[index];
      return dataUri === undefined ? [] : [[url, dataUri] as const];
    }),
  );
  return {
    embed: <Line extends DocumentLineImage>(line: Line): Line => {
      const embedded = line.imageUrl === undefined ? undefined : images.get(line.imageUrl);
      return embedded === undefined ? withoutPhoto(line) : { ...line, imageUrl: embedded };
    },
    embedded: images.size,
    missing: urls.length - images.size,
  };
}

/** A model with its photos embedded, and the count of each outcome. */
export interface EmbeddedPhotos<Model> {
  model: Model;
  /** Distinct photos that made it into the model. */
  embeddedPhotos: number;
  /** Distinct photos that could not be had; their rows print without one. */
  missingPhotos: number;
}

type LineMap = <Line extends DocumentLineImage>(line: Line) => Line;

/** Every row of a comprobante / cotización, through `map`. */
const mapDocumentLines = (model: DocumentModel, map: LineMap): DocumentModel => ({
  ...model,
  groups: model.groups.map((group) => ({ ...group, lines: group.lines.map(map) })),
});

/** Every row of a damage report — its deposit lines and its replacements — through `map`. */
const mapDamageReportLines = (model: DamageReportModel, map: LineMap): DamageReportModel => ({
  ...model,
  deposit: { ...model.deposit, lines: model.deposit.lines.map(map) },
  replacements: model.replacements.map(map),
});

/** The comprobante / cotización with every row photo embedded (or dropped). */
export async function embedDocumentImages(
  model: DocumentModel,
): Promise<EmbeddedPhotos<DocumentModel>> {
  const photos = await loadRowPhotos(model.groups.flatMap((group) => group.lines));
  return {
    model: mapDocumentLines(model, photos.embed),
    embeddedPhotos: photos.embedded,
    missingPhotos: photos.missing,
  };
}

/** The damage report with every row photo embedded (or dropped). */
export async function embedDamageReportImages(
  model: DamageReportModel,
): Promise<EmbeddedPhotos<DamageReportModel>> {
  const photos = await loadRowPhotos([...model.deposit.lines, ...model.replacements]);
  return {
    model: mapDamageReportLines(model, photos.embed),
    embeddedPhotos: photos.embedded,
    missingPhotos: photos.missing,
  };
}

/** The comprobante / cotización with NO photos — the render fallback (`downloadDocument`). */
export const withoutDocumentImages = (model: DocumentModel): DocumentModel =>
  mapDocumentLines(model, withoutPhoto);

/** The damage report with NO photos — the render fallback (`downloadDocument`). */
export const withoutDamageReportImages = (model: DamageReportModel): DamageReportModel =>
  mapDamageReportLines(model, withoutPhoto);
