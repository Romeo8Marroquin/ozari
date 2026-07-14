import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MAX_COUNT } from '@constants/Regex';
import { useGalleryImages } from './useGalleryImages';

const KEY = 'modules.panel.products.create.gallery.errors';

/** A picked file; `size` is faked via defineProperty so "5 MB" tests don't allocate 5 MB. */
const makeFile = (
  name = 'foto.png',
  { type = 'image/png', size = 1024, lastModified = 1 }: { type?: string; size?: number; lastModified?: number } = {},
): File => {
  const file = new File(['x'], name, { type, lastModified });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

beforeEach(() => {
  let counter = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${++counter}`);
  URL.revokeObjectURL = vi.fn();
});

describe('useGalleryImages — adding', () => {
  it('accepts valid files, previews them, and makes the FIRST photo the primary', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() => result.current.addFiles([makeFile('a.png'), makeFile('b.png', { lastModified: 2 })]));

    expect(result.current.images).toHaveLength(2);
    expect(result.current.images[0].previewUrl).toBe('blob:mock-1');
    expect(result.current.primaryId).toBe(result.current.images[0].id);
    expect(result.current.error).toBeUndefined();
    expect(result.current.isFull).toBe(false);
  });

  it('ignores an empty selection', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() => result.current.addFiles([]));
    expect(result.current.images).toHaveLength(0);
  });

  it('rejects a non-image type but still accepts the valid files of the same drop', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() =>
      result.current.addFiles([makeFile('doc.pdf', { type: 'application/pdf' }), makeFile('a.png')]),
    );

    expect(result.current.images).toHaveLength(1);
    expect(result.current.error).toBe(`${KEY}.invalidType`);
  });

  it('rejects an oversized file', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() => result.current.addFiles([makeFile('big.png', { size: PRODUCT_IMAGE_MAX_BYTES + 1 })]));

    expect(result.current.images).toHaveLength(0);
    expect(result.current.error).toBe(`${KEY}.tooLarge`);
  });

  it('rejects an empty (0-byte) file', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() => result.current.addFiles([makeFile('empty.png', { size: 0 })]));

    expect(result.current.images).toHaveLength(0);
    expect(result.current.error).toBe(`${KEY}.empty`);
  });

  it('rejects re-adding the same underlying file (name+size+mtime)', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() => result.current.addFiles([makeFile('a.png')]));
    act(() => result.current.addFiles([makeFile('a.png')]));

    expect(result.current.images).toHaveLength(1);
    expect(result.current.error).toBe(`${KEY}.duplicate`);
  });

  it('caps the gallery at the backend maximum and reports the overflow', () => {
    const { result } = renderHook(() => useGalleryImages());
    const files = Array.from({ length: PRODUCT_IMAGE_MAX_COUNT + 1 }, (_, i) =>
      makeFile(`foto-${i}.png`, { lastModified: i }),
    );
    act(() => result.current.addFiles(files));

    expect(result.current.images).toHaveLength(PRODUCT_IMAGE_MAX_COUNT);
    expect(result.current.isFull).toBe(true);
    expect(result.current.error).toBe(`${KEY}.tooMany`);
  });

  it('keeps the FIRST violation as the message when several rules fail', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() =>
      result.current.addFiles([
        makeFile('doc.pdf', { type: 'application/pdf' }),
        makeFile('big.png', { size: PRODUCT_IMAGE_MAX_BYTES + 1 }),
      ]),
    );
    expect(result.current.error).toBe(`${KEY}.invalidType`);
  });
});

describe('useGalleryImages — removing & the primary star', () => {
  it('removes a photo, revokes its preview URL, and clears any prior error', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() => result.current.addFiles([makeFile('a.png'), makeFile('doc.pdf', { type: 'application/pdf' })]));
    expect(result.current.error).toBe(`${KEY}.invalidType`);

    const id = result.current.images[0].id;
    act(() => result.current.removeImage(id));

    expect(result.current.images).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    expect(result.current.error).toBeUndefined();
  });

  it('hands the star to the first remaining photo when the primary is removed', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() =>
      result.current.addFiles([makeFile('a.png'), makeFile('b.png', { lastModified: 2 })]),
    );
    const [first, second] = result.current.images;
    expect(result.current.primaryId).toBe(first.id);

    act(() => result.current.removeImage(first.id));
    expect(result.current.primaryId).toBe(second.id);

    act(() => result.current.removeImage(second.id));
    expect(result.current.primaryId).toBeNull();
  });

  it('keeps the star put when a non-primary photo is removed', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() =>
      result.current.addFiles([makeFile('a.png'), makeFile('b.png', { lastModified: 2 })]),
    );
    const [first, second] = result.current.images;

    act(() => result.current.removeImage(second.id));
    expect(result.current.primaryId).toBe(first.id);
  });

  it('moves the star with setPrimary', () => {
    const { result } = renderHook(() => useGalleryImages());
    act(() =>
      result.current.addFiles([makeFile('a.png'), makeFile('b.png', { lastModified: 2 })]),
    );
    const second = result.current.images[1];

    act(() => result.current.setPrimary(second.id));
    expect(result.current.primaryId).toBe(second.id);
  });

  it('revokes every preview URL on unmount', () => {
    const { result, unmount } = renderHook(() => useGalleryImages());
    act(() =>
      result.current.addFiles([makeFile('a.png'), makeFile('b.png', { lastModified: 2 })]),
    );

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
