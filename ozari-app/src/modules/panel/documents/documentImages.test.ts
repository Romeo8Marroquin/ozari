import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The bytes come from OUR API (never the public assets host), so the app's client is what is
// stubbed: each call answers a Blob, or rejects the way axios does for a 4xx/5xx/timeout.
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get } }));

import { AxiosError, type AxiosResponse } from 'axios';
import {
  DOCUMENT_IMAGE_CONCURRENCY,
  DOCUMENT_IMAGE_ENDPOINT,
  DOCUMENT_IMAGE_MAX_PX,
  DOCUMENT_IMAGE_RETRY_DELAY_MS,
  DOCUMENT_IMAGE_TIMEOUT_MS,
  DOCUMENT_PHOTOS_BUDGET_MS,
  embedDamageReportImages,
  embedDocumentImages,
  loadDocumentImage,
  loadRowPhotos,
  withoutDamageReportImages,
  withoutDocumentImages,
} from './documentImages';
import type { DamageReportModel, DocumentModel } from './documentModel';

// jsdom has no image decoder and no canvas, so the browser's half is stubbed: `createImageBitmap`
// (the decode — the step that reads WebP/AVIF, which react-pdf cannot), then a 2D context whose
// pixels decide JPEG vs PNG.
const close = vi.fn();
let bitmap = { width: 800, height: 600, close };
let alpha = 255;
const drawImage = vi.fn();
const createImageBitmapMock = vi.fn(() => Promise.resolve(bitmap));

const ok = () => Promise.resolve({ data: new Blob(['x']) });

beforeEach(() => {
  vi.clearAllMocks();
  bitmap = { width: 800, height: 600, close };
  alpha = 255;
  get.mockImplementation(ok);
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

/** An axios-shaped failure: with a status it is an answer, without one it is "no answer at all". */
const httpError = (status?: number): AxiosError =>
  new AxiosError(
    'failed',
    status === undefined ? 'ECONNABORTED' : 'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    status === undefined ? undefined : ({ status } as AxiosResponse),
  );

describe('loadDocumentImage', () => {
  it('asks OUR API for the photo — never the public assets host — quietly and under a timeout', async () => {
    await loadDocumentImage('https://assets.example.com/products/a.webp');
    expect(get).toHaveBeenCalledWith(DOCUMENT_IMAGE_ENDPOINT, {
      params: { url: 'https://assets.example.com/products/a.webp' },
      responseType: 'blob',
      timeout: DOCUMENT_IMAGE_TIMEOUT_MS,
      // One count for the whole document, never a toast per photo.
      skipErrorNotification: true,
      // One slow photo may only ASK the health probe — never raise the outage overlay itself.
      confirmOutage: true,
    });
  });

  describe('the single retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      ['no answer at all (dropped connection / timeout)', undefined],
      ['a slow store (504)', 504],
      ['an edge hiccup (502)', 502],
      ['a rate limit (429)', 429],
      ['a request timeout (408)', 408],
    ])('retries once, after a short pause, on %s', async (_label, status) => {
      get.mockRejectedValueOnce(httpError(status));
      const pending = loadDocumentImage('https://assets.example.com/a.webp');
      await vi.advanceTimersByTimeAsync(DOCUMENT_IMAGE_RETRY_DELAY_MS - 1);
      expect(get).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatch(/^data:image\/jpeg/);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('gives up after the retry fails too', async () => {
      get.mockRejectedValue(httpError(504));
      const pending = loadDocumentImage('https://assets.example.com/a.webp');
      await vi.advanceTimersByTimeAsync(DOCUMENT_IMAGE_RETRY_DELAY_MS);
      expect(await pending).toBeUndefined();
      expect(get).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['not ours (400)', 400],
      ['forbidden (403)', 403],
      ['gone (404)', 404],
      ['not an image / too big (422)', 422],
    ])('never retries an answer about the photo itself: %s', async (_label, status) => {
      get.mockRejectedValueOnce(httpError(status));
      expect(await loadDocumentImage('https://assets.example.com/a.webp')).toBeUndefined();
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('never retries something that is not an HTTP failure at all', async () => {
      get.mockRejectedValueOnce(new Error('weird'));
      expect(await loadDocumentImage('https://assets.example.com/a.webp')).toBeUndefined();
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('never retries an undecodable photo — the bytes would be the same', async () => {
      createImageBitmapMock.mockRejectedValueOnce(new DOMException('decode'));
      expect(await loadDocumentImage('https://assets.example.com/a.avif')).toBeUndefined();
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('clips each attempt to the budget left, and skips a retry that could not finish', async () => {
      const deadline = Date.now() + 1_200;
      get.mockRejectedValueOnce(httpError(504));
      expect(await loadDocumentImage('https://assets.example.com/a.webp', deadline)).toBeUndefined();
      // The first attempt was given only what was left of the budget …
      expect(get).toHaveBeenCalledWith(
        DOCUMENT_IMAGE_ENDPOINT,
        expect.objectContaining({ timeout: 1_200 }),
      );
      // … and with under pause + a minimal attempt left, no retry was started.
      expect(get).toHaveBeenCalledTimes(1);
    });
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
    // Not found / not ours: the client rejects with an answer about the photo.
    get.mockRejectedValueOnce(httpError(404));
    expect(await loadDocumentImage('https://assets.example.com/gone.webp')).toBeUndefined();
    // A format this browser cannot decode.
    createImageBitmapMock.mockRejectedValueOnce(new DOMException('decode'));
    expect(await loadDocumentImage('https://assets.example.com/a.avif')).toBeUndefined();
    // No 2D canvas.
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    expect(await loadDocumentImage('https://assets.example.com/a.webp')).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

});

const CHAIR = 'https://assets.example.com/chair.webp';
const TABLE = 'https://assets.example.com/table.webp';
const GONE = 'https://assets.example.com/gone.webp';

/** The API answers every photo but GONE. */
const failGone = (): void => {
  get.mockImplementation((_endpoint: string, config: { params: { url: string } }) =>
    config.params.url === GONE ? Promise.reject(httpError(404)) : ok(),
  );
};

describe('loadRowPhotos', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.useRealTimers();
  });

  it('counts the DISTINCT photos it could not get — the number the admin is told', async () => {
    failGone();
    const photos = await loadRowPhotos([
      { imageUrl: CHAIR },
      { imageUrl: GONE },
      { imageUrl: GONE },
      {},
    ]);
    expect(photos.missing).toBe(1);
    expect(photos.embedded).toBe(1);
    expect(photos.embed({ imageUrl: GONE })).toEqual({});
    expect(photos.embed({ imageUrl: CHAIR }).imageUrl).toMatch(/^data:image\/jpeg/);
    expect(photos.embed({})).toEqual({});
  });

  it('offline, attempts nothing (each would only wait out its timeout) and counts every photo', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const photos = await loadRowPhotos([{ imageUrl: CHAIR }, { imageUrl: TABLE }]);
    expect(get).not.toHaveBeenCalled();
    expect(photos.missing).toBe(2);
    expect(photos.embed({ imageUrl: CHAIR })).toEqual({});
  });

  it(`keeps at most ${DOCUMENT_IMAGE_CONCURRENCY} photos in flight, and still gets every one`, async () => {
    let inFlight = 0;
    let peak = 0;
    get.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { data: new Blob(['x']) };
    });
    const lines = Array.from({ length: 11 }, (_, index) => ({
      imageUrl: `https://assets.example.com/${index}.webp`,
    }));
    const photos = await loadRowPhotos(lines);
    expect(peak).toBe(DOCUMENT_IMAGE_CONCURRENCY);
    expect(get).toHaveBeenCalledTimes(11);
    expect(photos.missing).toBe(0);
  });

  it('skips — and counts — the photos not yet started when the budget runs out', async () => {
    vi.useFakeTimers();
    // Each photo answers only as the budget expires, so the pool gets through one wave of four …
    // and by the time a worker is free again, the budget is gone.
    get.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: new Blob(['x']) }), DOCUMENT_PHOTOS_BUDGET_MS);
        }),
    );
    const lines = Array.from({ length: 6 }, (_, index) => ({
      imageUrl: `https://assets.example.com/${index}.webp`,
    }));
    const pending = loadRowPhotos(lines);
    await vi.advanceTimersByTimeAsync(DOCUMENT_PHOTOS_BUDGET_MS);
    const photos = await pending;
    expect(get).toHaveBeenCalledTimes(DOCUMENT_IMAGE_CONCURRENCY);
    expect(photos.embedded).toBe(DOCUMENT_IMAGE_CONCURRENCY);
    expect(photos.missing).toBe(6 - DOCUMENT_IMAGE_CONCURRENCY);
  });
});

describe('the render fallbacks', () => {
  it('strip every photo from a comprobante, leaving everything else', () => {
    const model = {
      kind: 'receipt',
      groups: [{ kind: 'sale', lines: [{ description: 'A', imageUrl: 'data:x' }, { description: 'B' }] }],
    } as unknown as DocumentModel;
    expect(withoutDocumentImages(model)).toEqual({
      kind: 'receipt',
      groups: [{ kind: 'sale', lines: [{ description: 'A' }, { description: 'B' }] }],
    });
  });

  it('strip every photo from a damage report', () => {
    const report = {
      reference: 8,
      deposit: { total: 1, lines: [{ description: 'A', imageUrl: 'data:x' }] },
      replacements: [{ description: 'B', imageUrl: 'data:y' }],
    } as unknown as DamageReportModel;
    expect(withoutDamageReportImages(report)).toEqual({
      reference: 8,
      deposit: { total: 1, lines: [{ description: 'A' }] },
      replacements: [{ description: 'B' }],
    });
  });
});

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
    const { model: embedded } = await embedDocumentImages(model);
    // CHAIR appears twice, fetched once.
    expect(get).toHaveBeenCalledTimes(3);
    const [rental, sale] = embedded.groups;
    expect(rental?.lines[0]?.imageUrl).toMatch(/^data:image\/jpeg/);
    expect(rental?.lines[1]?.imageUrl).toMatch(/^data:image\/jpeg/);
    expect(sale?.lines[0]?.imageUrl).toBe(rental?.lines[0]?.imageUrl);
  });

  it('drops a photo that could not be had — the row prints as a row without one — and COUNTS it', async () => {
    failGone();
    const { model: embedded, missingPhotos } = await embedDocumentImages(model);
    expect(missingPhotos).toBe(1);
    const [rental, sale] = embedded.groups;
    expect(sale?.lines[1]).not.toHaveProperty('imageUrl');
    expect(sale?.lines[1]?.description).toBe('Perdida');
    // A row that never had a photo is untouched.
    expect(rental?.lines[2]).toEqual(line('Sin foto'));
    // Everything else about the model is carried over.
    expect(embedded.kind).toBe('receipt');
    expect(rental?.subtotal).toBe(30);
  });

  it('never touches the network for a document without photos, and reports nothing missing', async () => {
    const plain = { groups: [{ kind: 'sale', lines: [line('Sin foto')], subtotal: 10 }] };
    const { missingPhotos } = await embedDocumentImages(plain as unknown as DocumentModel);
    expect(get).not.toHaveBeenCalled();
    expect(missingPhotos).toBe(0);
  });
});

describe('embedDamageReportImages', () => {
  it('embeds the deposit lines’ and the replacements’ photos, dropping and counting the ones it cannot get', async () => {
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
    const { model: embedded, missingPhotos } = await embedDamageReportImages(report);
    expect(get).toHaveBeenCalledTimes(2);
    expect(missingPhotos).toBe(1);
    expect(embedded.deposit.lines[0]?.imageUrl).toMatch(/^data:image\/jpeg/);
    expect(embedded.deposit.lines[1]).not.toHaveProperty('imageUrl');
    expect(embedded.deposit.total).toBe(100);
    expect(embedded.replacements[0]?.imageUrl).toBe(embedded.deposit.lines[0]?.imageUrl);
    expect(embedded.replacements[1]).not.toHaveProperty('imageUrl');
    expect(embedded.reference).toBe(8);
  });
});
