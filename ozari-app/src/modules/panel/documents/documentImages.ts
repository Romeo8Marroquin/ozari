import type {
  DamageReportModel,
  DocumentLineImage,
  DocumentModel,
} from './documentModel';

/**
 * The row photos, made SAFE to print (EPIC-2-DOCUMENTS §2d, 2026-10-29).
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
 * A photo that cannot be had for ANY reason (CORS, 404, offline, a format this browser cannot
 * decode, the timeout) is dropped from its row, and the row prints exactly as a row with no photo:
 * **a picture never costs the document.**
 *
 * ⚠️ The fetch is a CORS request to the public assets host, so it needs that host in the CSP's
 * `connect-src` (`index.html`) AND a GET rule in the bucket's CORS policy (Terraform,
 * `modules/cloudflare-env/r2.tf`). Without either, every photo is dropped — the documents still
 * generate, just without pictures.
 */

/** How long ONE photo may take before its row prints without it. The photos load in parallel and
 *  alongside the renderer chunk, so this bounds the whole wait rather than adding up per row. */
export const DOCUMENT_IMAGE_TIMEOUT_MS = 6000;

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
 * ONE photo, or `undefined` — never a rejection. `cache: 'no-store'` is deliberate: the same URL is
 * usually already in the HTTP cache from the catalog's plain `<img>` tags, which are not CORS
 * requests, and a browser may answer this CORS request from that entry — which carries no
 * `Access-Control-Allow-Origin` and therefore fails. Asking the network sidesteps it.
 */
export async function loadDocumentImage(
  url: string,
  timeoutMs: number = DOCUMENT_IMAGE_TIMEOUT_MS,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return await toThumbnail(await response.blob());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Every distinct photo URL the rows reference — each fetched once, however many rows show it. */
function distinctUrls(lines: readonly DocumentLineImage[]): string[] {
  return [
    ...new Set(lines.flatMap((line) => (line.imageUrl === undefined ? [] : [line.imageUrl]))),
  ];
}

/** URL → embeddable `data:` URI, for the photos that could be had. */
async function loadAll(urls: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const loaded = await Promise.all(
    urls.map(async (url) => [url, await loadDocumentImage(url)] as const),
  );
  return new Map(
    loaded.flatMap(([url, dataUri]) => (dataUri === undefined ? [] : [[url, dataUri] as const])),
  );
}

/** A line with its photo swapped for the embeddable copy — or WITHOUT a photo when none was had. */
function embedLine<Line extends DocumentLineImage>(
  line: Line,
  images: ReadonlyMap<string, string>,
): Line {
  if (line.imageUrl === undefined) return line;
  const { imageUrl, ...rest } = line;
  const embedded = images.get(imageUrl);
  return (embedded === undefined ? rest : { ...rest, imageUrl: embedded }) as Line;
}

/** The comprobante / cotización with every row photo embedded (or dropped). */
export async function embedDocumentImages(model: DocumentModel): Promise<DocumentModel> {
  const images = await loadAll(distinctUrls(model.groups.flatMap((group) => group.lines)));
  return {
    ...model,
    groups: model.groups.map((group) => ({
      ...group,
      lines: group.lines.map((line) => embedLine(line, images)),
    })),
  };
}

/** The damage report with every row photo embedded (or dropped). */
export async function embedDamageReportImages(
  model: DamageReportModel,
): Promise<DamageReportModel> {
  const images = await loadAll(distinctUrls([...model.deposit.lines, ...model.replacements]));
  return {
    ...model,
    deposit: {
      ...model.deposit,
      lines: model.deposit.lines.map((line) => embedLine(line, images)),
    },
    replacements: model.replacements.map((line) => embedLine(line, images)),
  };
}
