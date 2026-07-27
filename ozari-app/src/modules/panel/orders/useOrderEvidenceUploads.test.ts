import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post: apiPost } }));

const { axiosPut } = vi.hoisted(() => ({ axiosPut: vi.fn() }));
vi.mock('axios', () => ({ default: { put: axiosPut } }));

import { useOrderEvidenceUploads } from './useOrderEvidenceUploads';

const photo = (name: string): File => {
  const file = new File(['x'], name, { type: 'image/webp' });
  Object.defineProperty(file, 'size', { value: 2048 });
  return file;
};

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

describe('useOrderEvidenceUploads', () => {
  it('resolves with no keys and no network when there is nothing to upload', async () => {
    const { result } = renderHook(() => useOrderEvidenceUploads());
    await expect(result.current.uploadEvidence([])).resolves.toEqual([]);
    expect(apiPost).not.toHaveBeenCalled();
    expect(axiosPut).not.toHaveBeenCalled();
  });

  it('mints one presign per photo, PUTs each straight to R2, and returns the KEYS', async () => {
    apiPost.mockResolvedValue(presignResponse(['orders/evidence/a.webp', 'orders/evidence/b.webp']));
    axiosPut.mockResolvedValue({});
    const files = [photo('entrega-1.webp'), photo('entrega-2.webp')];

    const { result } = renderHook(() => useOrderEvidenceUploads());
    await expect(result.current.uploadEvidence(files)).resolves.toEqual([
      'orders/evidence/a.webp',
      'orders/evidence/b.webp',
    ]);

    // The presign describes each file; the dialog owns its errors, so the interceptor stays quiet.
    expect(apiPost).toHaveBeenCalledWith(
      '/orders/evidence/upload-url',
      { files: [
        { contentType: 'image/webp', contentLength: 2048 },
        { contentType: 'image/webp', contentLength: 2048 },
      ] },
      { skipErrorNotification: true },
    );
    // The upload goes to R2 with the BARE axios instance (no app headers/interceptors), with the
    // exact content type bound into the signature and its own generous timeout.
    expect(axiosPut).toHaveBeenCalledTimes(2);
    expect(axiosPut).toHaveBeenNthCalledWith(1, 'https://r2.test/put/orders/evidence/a.webp', files[0], {
      headers: { 'Content-Type': 'image/webp' },
      timeout: 120_000,
    });
  });

  it('treats a presign response with no uploads as nothing to send', async () => {
    apiPost.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useOrderEvidenceUploads());
    await expect(result.current.uploadEvidence([photo('a.webp')])).resolves.toEqual([]);
    expect(axiosPut).not.toHaveBeenCalled();
  });

  it('flags uploading while in flight and always clears it, even on failure', async () => {
    let release: (value: unknown) => void = () => {};
    apiPost.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useOrderEvidenceUploads());

    const pending = result.current.uploadEvidence([photo('a.webp')]);
    await waitFor(() => expect(result.current.isUploading).toBe(true));
    release(presignResponse(['orders/evidence/a.webp']));
    axiosPut.mockResolvedValue({});
    await pending;
    await waitFor(() => expect(result.current.isUploading).toBe(false));

    // A failed PUT rejects the batch (the dialog keeps the picked files so the user retries).
    apiPost.mockResolvedValue(presignResponse(['orders/evidence/a.webp']));
    axiosPut.mockRejectedValue(new Error('network'));
    await expect(result.current.uploadEvidence([photo('a.webp')])).rejects.toThrow('network');
    await waitFor(() => expect(result.current.isUploading).toBe(false));
  });
});
