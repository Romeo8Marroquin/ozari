import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_COUNT,
  PRODUCT_IMAGE_TYPES,
} from '@constants/Regex';
import type { ProductImage } from './product.types';

const KEY = 'modules.panel.products.create.gallery.errors';

/**
 * A photo staged in the gallery. Two flavors, discriminated by which optional field is present:
 * a NEW photo carries the `file` to upload (+ a local object-URL preview); an EXISTING photo
 * (edit mode, seeded from the product) carries its DB row id in `existingId` and previews from its
 * public URL. The save maps them to the declarative body: existing by `id`, new by uploaded `key`.
 */
export interface GalleryImage {
  /** Stable local id (never sent to the API) — keys the list, the primary flag and progress. */
  id: string;
  /** What the thumbnail renders: an object URL (new) or the public R2 URL (existing). */
  previewUrl: string;
  /** Display name for a11y labels (file name, or a positional label for existing photos). */
  name: string;
  /** The staged File to upload — present only on NEW photos. */
  file?: File;
  /** The `product_images` row id — present only on EXISTING photos. */
  existingId?: number;
}

export interface GalleryState {
  images: GalleryImage[];
  /** The image shown on the product card. Always one of `images` while the gallery is non-empty. */
  primaryId: string | null;
  /** The last add/remove validation message (type/size/cap/duplicate), cleared by the next action. */
  error: string | undefined;
  addFiles: (files: Iterable<File>) => void;
  removeImage: (id: string) => void;
  setPrimary: (id: string) => void;
  /** Reorder: move the image to `toIndex` (clamped). The primary flag rides the id, not the slot. */
  moveImage: (id: string, toIndex: number) => void;
  /** Whether the gallery is at the backend's per-product cap (the picker hides itself). */
  isFull: boolean;
}

let localIdCounter = 0;
/** Monotonic local id — enough for keys within one mount; survives same-name re-adds. */
const nextLocalId = (): string => `gallery-${++localIdCounter}`;

/** Two picks of the same underlying file (name+size+mtime) are one photo — silently a duplicate. */
const fingerprint = (file: File): string => `${file.name}|${file.size}|${file.lastModified}`;

/** Seeds the gallery from a product's existing photos (edit mode) — input order = display order. */
const seedFromProduct = (initialImages: ProductImage[]): GalleryImage[] =>
  initialImages.map((image, index) => ({
    id: nextLocalId(),
    previewUrl: image.url,
    name: `foto-${index + 1}`,
    existingId: image.id,
  }));

/**
 * Owns the product-photo gallery state for the create/edit form. Deliberately OUTSIDE
 * react-hook-form: `File` objects can't be drafted to sessionStorage (the silent-draft doctrine
 * keeps drafts to the serializable fields), and gallery validation is imperative (validate on add,
 * not on submit). The mirror contract still holds — count/type/size mirror `appConfig.storage`, and
 * the backend re-enforces every rule (the presign binds type+size into the signature; create/update
 * cap the list).
 *
 * `initialImages` (edit mode) seeds the grid with the product's EXISTING photos — read once on
 * mount; every movement after that (add/remove/reorder/star) is staged locally, zero network, and
 * only the save sends the final state (the RECONCILE design).
 *
 * Preview URLs of NEW photos are `URL.createObjectURL` handles — revoked on remove and on unmount
 * (never leaked); existing photos preview from their public URL (nothing to revoke). The primary
 * defaults to the flagged/first photo and follows removals; `setPrimary` moves the star; the order
 * and the star are INDEPENDENT — any slot can be the primary.
 */
export function useGalleryImages(initialImages?: ProductImage[]): GalleryState {
  const { t } = useTranslation();
  // Seed ONCE (lazy initializer): both the list and the starred id come from the same seeded array,
  // so their local ids always agree. The flagged photo takes the star; a flag-less seed falls back
  // to the first (mirroring the backend default).
  const [seeded] = useState(() => seedFromProduct(initialImages ?? []));
  const [images, setImages] = useState<GalleryImage[]>(seeded);
  const [primaryId, setPrimaryId] = useState<string | null>(() => {
    const flaggedIndex = (initialImages ?? []).findIndex((image) => image.isPrimary);
    return seeded.length === 0 ? null : seeded[Math.max(flaggedIndex, 0)].id;
  });
  const [error, setError] = useState<string | undefined>(undefined);

  // Unmount cleanup only — live revocation happens in removeImage. A ref mirror (updated in an
  // effect, never during render) lets the unmount effect see the latest list without re-running
  // (and revoking in-use URLs) on every change. Only NEW photos hold revocable object URLs.
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(
    () => () => {
      for (const image of imagesRef.current) {
        if (image.file) URL.revokeObjectURL(image.previewUrl);
      }
    },
    [],
  );

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      setError(undefined);
      const incoming = [...files];
      if (incoming.length === 0) return;

      setImages((current) => {
        const known = new Set(
          current.flatMap((image) => (image.file ? [fingerprint(image.file)] : [])),
        );
        const accepted: GalleryImage[] = [];
        let firstError: string | undefined;
        // First rule violation wins the message; valid files are still accepted (a mixed drop adds
        // what it can instead of failing wholesale).
        const reject = (message: string): void => {
          firstError ??= message;
        };

        for (const file of incoming) {
          if (!PRODUCT_IMAGE_TYPES.includes(file.type)) {
            reject(t(`${KEY}.invalidType`));
            continue;
          }
          if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
            reject(t(`${KEY}.tooLarge`));
            continue;
          }
          if (file.size <= 0) {
            reject(t(`${KEY}.empty`));
            continue;
          }
          if (known.has(fingerprint(file))) {
            reject(t(`${KEY}.duplicate`));
            continue;
          }
          if (current.length + accepted.length >= PRODUCT_IMAGE_MAX_COUNT) {
            reject(t(`${KEY}.tooMany`, { max: PRODUCT_IMAGE_MAX_COUNT }));
            break;
          }
          known.add(fingerprint(file));
          accepted.push({
            id: nextLocalId(),
            file,
            name: file.name,
            previewUrl: URL.createObjectURL(file),
          });
        }

        if (firstError) setError(firstError);
        if (accepted.length === 0) return current;
        const next = [...current, ...accepted];
        // First photo ever → it is the primary until the user stars another.
        setPrimaryId((currentPrimary) => currentPrimary ?? next[0].id);
        return next;
      });
    },
    [t],
  );

  const removeImage = useCallback((id: string) => {
    setError(undefined);
    setImages((current) => {
      const removed = current.find((image) => image.id === id);
      // Only NEW photos hold an object URL to release; an existing photo's URL is just remote.
      if (removed?.file) URL.revokeObjectURL(removed.previewUrl);
      const next = current.filter((image) => image.id !== id);
      // The star never dangles: removing the primary hands it to the first remaining photo.
      setPrimaryId((currentPrimary) =>
        currentPrimary === id ? (next[0]?.id ?? null) : currentPrimary,
      );
      return next;
    });
  }, []);

  const setPrimary = useCallback((id: string) => {
    setError(undefined);
    setPrimaryId(id);
  }, []);

  const moveImage = useCallback((id: string, toIndex: number) => {
    setImages((current) => {
      const fromIndex = current.findIndex((image) => image.id === id);
      const clamped = Math.max(0, Math.min(toIndex, current.length - 1));
      if (fromIndex === -1 || fromIndex === clamped) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(clamped, 0, moved);
      return next;
    });
  }, []);

  return {
    images,
    primaryId,
    error,
    addFiles,
    removeImage,
    setPrimary,
    moveImage,
    isFull: images.length >= PRODUCT_IMAGE_MAX_COUNT,
  };
}
