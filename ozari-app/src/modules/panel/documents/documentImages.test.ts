import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCUMENT_IMAGE_MAX_PX,
  DOCUMENT_IMAGE_TIMEOUT_MS,
  embedDamageReportImages,
  embedDocumentImages,
  loadDocumentImage,
} from './documentImages';
import type { DamageReportModel, DocumentModel } from './documentModel';

// jsdom has no image decoder and no canvas, so the browser's half is stubbed: `fetch`, then
// `createImageBitmap` (the decode — the step that reads WebP/AVIF, which react-pdf cannot), then a
// 2D context whose pixels decide JPEG vs PNG.
const close = vi.fn();
let bitmap = { width: 800, height: 600, close };
let alpha = 255;
const drawImage = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
const createImageBitmapMock = vi.fn(() => Promise.resolve(bitmap));

const okResponse = (): Response =>
  ({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) }) as unknown as Response;

beforeEach(() => {
  vi.clearAllMocks();
  bitmap = { width: 800, height: 600, close };
  alpha = 255;
  fetchMock.mockImplementation(() => Promise.resolve(okResponse()));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('createImageBitmap', createImageBitmapMock);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage,
        getImageData: (_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4).map((_, index) =>
            index % 4 === 3 ? alpha : 0,
          ),
        }),
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
    type?: string,
  ) {
    return `data:${type ?? 'image/png'};${this.width}x${this.height}`;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadDocumentImage', () => {
  it('fetches the photo as a CORS request that skips the HTTP cache', async () => {
    await loadDocumentImage('https://assets.example.com/a.webp');
    // `no-store`: the catalog's plain <img> tags cached this URL WITHOUT CORS headers, and a CORS
    // request answered from that entry fails.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://assets.example.com/a.webp',
      expect.objectContaining({ mode: 'cors', credentials: 'omit', cache: 'no-store' }),
    );
  });

  it('downscales an opaque photo to a small JPEG, keeping its proportions', async () => {
    const uri = await loadDocumentImage('https://assets.example.com/a.webp');
    // 800×600 → longest side 160, the other in proportion.
    expect(uri).toBe(`data:image/jpeg;${DOCUMENT_IMAGE_MAX_PX}x120`);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, DOCUMENT_IMAGE_MAX_PX, 120);
    // The decoded bitmap is released — a document of thirty rows decodes thirty of them.
    expect(close).toHaveBeenCalled();
  });

  it('keeps a transparent photo as PNG, so its background never prints as a white box', async () => {
    alpha = 0;
    bitmap = { width: 300, height: 600, close };
    expect(await loadDocumentImage('https://assets.example.com/cutout.png')).toBe(
      'data:image/png;80x160',
    );
  });

  it('never upscales a photo smaller than the thumbnail', async () => {
    bitmap = { width: 40, height: 20, close };
    expect(await loadDocumentImage('https://assets.example.com/tiny.png')).toBe(
      'data:image/jpeg;40x20',
    );
  });

  it('resolves to nothing — never rejects — when the photo cannot be had', async () => {
    // Not found / forbidden.
    fetchMock.mockResolvedValueOnce({ ok: false } as Response);
    expect(await loadDocumentImage('https://assets.example.com/gone.webp')).toBeUndefined();
    // CORS refusal or offline: fetch rejects.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await loadDocumentImage('https://assets.example.com/cors.webp')).toBeUndefined();
    // A format this browser cannot decode.
    createImageBitmapMock.mockRejectedValueOnce(new DOMException('decode'));
    expect(await loadDocumentImage('https://assets.example.com/a.avif')).toBeUndefined();
    // No 2D canvas.
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    expect(await loadDocumentImage('https://assets.example.com/a.webp')).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('gives up after the timeout instead of stalling the document', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
          }),
      );
      const pending = loadDocumentImage('https://assets.example.com/slow.webp');
      vi.advanceTimersByTime(DOCUMENT_IMAGE_TIMEOUT_MS);
      expect(await pending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

const CHAIR = 'https://assets.example.com/chair.webp';
const TABLE = 'https://assets.example.com/table.webp';
const GONE = 'https://assets.example.com/gone.webp';

/** `fetch` that answers every URL but GONE. */
const failGone = (): void => {
  fetchMock.mockImplementation((url) =>
    Promise.resolve(url === GONE ? ({ ok: false } as Response) : okResponse()),
  );
};

describe('embedDocumentImages', () => {
  const line = (description: string, imageUrl?: string) => ({
    description,
    quantity: 1,
    unitPrice: 10,
    total: 10,
    ...(imageUrl !== undefined && { imageUrl }),
  });
  const model = {
    kind: 'receipt',
    groups: [
      { kind: 'rental', lines: [line('Silla', CHAIR), line('Mesa', TABLE), line('Sin foto')], subtotal: 30 },
      { kind: 'sale', lines: [line('Otra silla', CHAIR), line('Perdida', GONE)], subtotal: 20 },
    ],
  } as unknown as DocumentModel;

  it('fetches each DISTINCT photo once and embeds it in every row that shows it', async () => {
    failGone();
    const embedded = await embedDocumentImages(model);
    // CHAIR appears twice, fetched once.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [rental, sale] = embedded.groups;
    expect(rental?.lines[0]?.imageUrl).toMatch(/^data:image\/jpeg/);
    expect(rental?.lines[1]?.imageUrl).toMatch(/^data:image\/jpeg/);
    expect(sale?.lines[0]?.imageUrl).toBe(rental?.lines[0]?.imageUrl);
  });

  it('drops a photo that could not be had — the row prints as a row without one', async () => {
    failGone();
    const embedded = await embedDocumentImages(model);
    const [rental, sale] = embedded.groups;
    expect(sale?.lines[1]).not.toHaveProperty('imageUrl');
    expect(sale?.lines[1]?.description).toBe('Perdida');
    // A row that never had a photo is untouched.
    expect(rental?.lines[2]).toEqual(line('Sin foto'));
    // Everything else about the model is carried over.
    expect(embedded.kind).toBe('receipt');
    expect(rental?.subtotal).toBe(30);
  });

  it('never touches the network for a document without photos', async () => {
    const plain = { groups: [{ kind: 'sale', lines: [line('Sin foto')], subtotal: 10 }] };
    await embedDocumentImages(plain as unknown as DocumentModel);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('embedDamageReportImages', () => {
  it('embeds the deposit lines’ and the replacements’ photos, dropping the ones it cannot get', async () => {
    failGone();
    const report = {
      reference: 8,
      deposit: {
        total: 100,
        lines: [
          { description: 'Silla', quantity: 1, unitAmount: 100, total: 100, imageUrl: CHAIR },
          { description: 'Sin foto', quantity: 1, unitAmount: 0, total: 0 },
        ],
      },
      replacements: [
        { description: 'Silla', quantity: 1, unitAmount: 50, amount: 50, imageUrl: CHAIR },
        { description: 'Perdida', quantity: 1, unitAmount: 50, amount: 50, imageUrl: GONE },
      ],
    } as unknown as DamageReportModel;
    const embedded = await embedDamageReportImages(report);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(embedded.deposit.lines[0]?.imageUrl).toMatch(/^data:image\/jpeg/);
    expect(embedded.deposit.lines[1]).not.toHaveProperty('imageUrl');
    expect(embedded.deposit.total).toBe(100);
    expect(embedded.replacements[0]?.imageUrl).toBe(embedded.deposit.lines[0]?.imageUrl);
    expect(embedded.replacements[1]).not.toHaveProperty('imageUrl');
    expect(embedded.reference).toBe(8);
  });
});
