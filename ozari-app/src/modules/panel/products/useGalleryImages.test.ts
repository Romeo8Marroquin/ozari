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

describe('useGalleryImages — seeding from a product (edit mode)', () => {
  const productImages = [
    { id: 11, url: 'https://cdn/a.webp', isPrimary: false, sortOrder: 0 },
    { id: 12, url: 'https://cdn/b.webp', isPrimary: true, sortOrder: 1 },
  ];

  it('seeds existing photos in display order, starring the FLAGGED one', () => {
    const { result } = renderHook(() => useGalleryImages(productImages));

    expect(result.current.images).toHaveLength(2);
    expect(result.current.images[0]).toMatchObject({
      existingId: 11,
      previewUrl: 'https://cdn/a.webp',
      name: 'foto-1',
    });
    expect(result.current.images[0].file).toBeUndefined();
    // The star follows the isPrimary flag, NOT the position.
    expect(result.current.primaryId).toBe(result.current.images[1].id);
  });

  it('falls back to the FIRST photo when no seed is flagged (the backend default)', () => {
    const flagless = productImages.map((image) => ({ ...image, isPrimary: false }));
    const { result } = renderHook(() => useGalleryImages(flagless));
    expect(result.current.primaryId).toBe(result.current.images[0].id);
  });

  it('mixes staged files in after the seed, and the duplicate check ignores existing photos', () => {
    const { result } = renderHook(() => useGalleryImages(productImages));
    act(() => result.current.addFiles([makeFile('c.png')]));

    expect(result.current.images).toHaveLength(3);
    expect(result.current.images[2].file).toBeDefined();
    expect(result.current.error).toBeUndefined();
  });

  it('removing an EXISTING photo never revokes (its URL is remote, not an object URL)', () => {
    const { result, unmount } = renderHook(() => useGalleryImages(productImages));
    act(() => result.current.removeImage(result.current.images[0].id));

    expect(result.current.images).toHaveLength(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    // Unmount cleanup skips existing photos too.
    unmount();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});

describe('useGalleryImages — reordering', () => {
  const threePhotos = () => {
    const view = renderHook(() => useGalleryImages());
    act(() =>
      view.result.current.addFiles([
        makeFile('a.png', { lastModified: 1 }),
        makeFile('b.png', { lastModified: 2 }),
        makeFile('c.png', { lastModified: 3 }),
      ]),
    );
    return view;
  };

  it('moves a photo to the target slot — the star rides the PHOTO, never the slot', () => {
    const { result } = threePhotos();
    const [a, b, c] = result.current.images;
    expect(result.current.primaryId).toBe(a.id);

    act(() => result.current.moveImage(c.id, 0));
    expect(result.current.images.map((image) => image.id)).toEqual([c.id, a.id, b.id]);
    // The primary is still photo `a`, now in the middle — order and star are independent.
    expect(result.current.primaryId).toBe(a.id);
  });

  it('clamps an out-of-range target index to the ends', () => {
    const { result } = threePhotos();
    const [a, , c] = result.current.images;

    act(() => result.current.moveImage(a.id, 99));
    expect(result.current.images[2].id).toBe(a.id);

    act(() => result.current.moveImage(c.id, -5));
    expect(result.current.images[0].id).toBe(c.id);
  });

  it('no-ops for an unknown id and for a same-slot move', () => {
    const { result } = threePhotos();
    const before = result.current.images;

    act(() => result.current.moveImage('gallery-nope', 0));
    expect(result.current.images).toBe(before);

    act(() => result.current.moveImage(before[1].id, 1));
    expect(result.current.images).toBe(before);
  });
});
