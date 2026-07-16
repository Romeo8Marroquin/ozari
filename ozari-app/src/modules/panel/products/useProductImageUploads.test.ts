import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post: apiPost } }));

const { axiosPut } = vi.hoisted(() => ({ axiosPut: vi.fn() }));
vi.mock('axios', () => ({ default: { put: axiosPut } }));

import type { GalleryImage } from './useGalleryImages';
import { useProductImageUploads } from './useProductImageUploads';

const image = (id: string, name = `${id}.png`): GalleryImage => {
  const file = new File(['x'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: 2048 });
  return { id, file, name, previewUrl: `blob:${id}` };
};

/** An EXISTING (already-uploaded) photo — no `file`, so it must never upload again. */
const existingImage = (id: string, existingId: number): GalleryImage => ({
  id,
  existingId,
  name: `foto-${existingId}`,
  previewUrl: `https://cdn.test/products/${existingId}.webp`,
});

const presignResponse = (keys: string[]) => ({
  data: {
    data: {
      uploads: keys.map((key) => ({
        uploadUrl: `https://r2.test/put/${key}`,
        key,
        publicUrl: `https://cdn.test/${key}`,
      })),
    },
  },
});

beforeEach(() => vi.clearAllMocks());

describe('useProductImageUploads', () => {
  it('resolves {} immediately for an empty gallery — no network at all', async () => {
    const { result } = renderHook(() => useProductImageUploads());
    await expect(result.current.uploadImages([])).resolves.toEqual({});
    expect(apiPost).not.toHaveBeenCalled();
    expect(axiosPut).not.toHaveBeenCalled();
  });

  it('resolves {} for a gallery of only EXISTING photos — kept photos never re-upload', async () => {
    const { result } = renderHook(() => useProductImageUploads());
    await expect(
      result.current.uploadImages([existingImage('a', 11), existingImage('b', 12)]),
    ).resolves.toEqual({});
    expect(apiPost).not.toHaveBeenCalled();
    expect(axiosPut).not.toHaveBeenCalled();
  });

  it('mints presigned URLs then PUTs each file straight to R2, returning keys by local id', async () => {
    apiPost.mockResolvedValue(presignResponse(['products/k1.png', 'products/k2.png']));
    axiosPut.mockResolvedValue({});
    const images = [image('a'), image('b')];

    const { result } = renderHook(() => useProductImageUploads());
    const keys = await result.current.uploadImages(images);

    expect(keys).toEqual({ a: 'products/k1.png', b: 'products/k2.png' });
    // The presign request carries type + exact size (both bound into the signature server-side).
    expect(apiPost).toHaveBeenCalledWith(
      '/products/images/upload-url',
      {
        files: [
          { contentType: 'image/png', contentLength: 2048 },
          { contentType: 'image/png', contentLength: 2048 },
        ],
      },
      { skipErrorNotification: true },
    );
    // Direct-to-R2: bare axios (not the api instance) with the exact Content-Type and its OWN
    // stall guard (the bare instance has no default timeout).
    expect(axiosPut).toHaveBeenCalledWith(
      'https://r2.test/put/products/k1.png',
      images[0].file,
      expect.objectContaining({ headers: { 'Content-Type': 'image/png' }, timeout: 120_000 }),
    );
  });

  it('tracks per-image progress and toggles isUploading around the batch', async () => {
    apiPost.mockResolvedValue(presignResponse(['products/k1.png']));
    let capturedOnProgress: ((event: { loaded: number; total?: number }) => void) | undefined;
    let releasePut: () => void = () => undefined;
    axiosPut.mockImplementation((_url, _file, config: { onUploadProgress: typeof capturedOnProgress }) => {
      capturedOnProgress = config.onUploadProgress;
      return new Promise<void>((resolve) => {
        releasePut = resolve;
      });
    });

    const { result } = renderHook(() => useProductImageUploads());
    let pending: Promise<Record<string, string>>;
    act(() => {
      // A mixed gallery: the kept photo is skipped entirely; only the new file presigns/uploads.
      pending = result.current.uploadImages([existingImage('kept', 11), image('a')]);
    });

    await vi.waitFor(() => expect(result.current.isUploading).toBe(true));

    act(() => capturedOnProgress?.({ loaded: 512, total: 2048 }));
    expect(result.current.progress['a']).toBe(0.25);

    // No total (some agents omit it) → ratio falls back to 0 instead of NaN.
    act(() => capturedOnProgress?.({ loaded: 512 }));
    expect(result.current.progress['a']).toBe(0);

    act(() => releasePut());
    await act(async () => {
      await pending;
    });
    expect(result.current.isUploading).toBe(false);
  });

  it('propagates a failure (presign or PUT) and always clears isUploading', async () => {
    apiPost.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useProductImageUploads());
    await expect(result.current.uploadImages([image('a')])).rejects.toThrow('403');
    expect(result.current.isUploading).toBe(false);

    apiPost.mockResolvedValue(presignResponse(['products/k1.png']));
    axiosPut.mockRejectedValue(new Error('network'));
    await expect(result.current.uploadImages([image('a')])).rejects.toThrow('network');
    expect(result.current.isUploading).toBe(false);
  });

  it('treats a malformed presign payload (no data) as zero uploads', async () => {
    apiPost.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useProductImageUploads());
    await expect(result.current.uploadImages([image('a')])).resolves.toEqual({});
    expect(axiosPut).not.toHaveBeenCalled();
  });
});
