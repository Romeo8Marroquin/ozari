import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_COUNT,
  PRODUCT_IMAGE_TYPES,
} from '@constants/Regex';

const KEY = 'modules.panel.products.create.gallery.errors';

/** A picked photo staged in the gallery: the File to upload + its local object-URL preview. */
export interface GalleryImage {
  /** Stable local id (never sent to the API) — keys the list, the primary flag and progress. */
  id: string;
  file: File;
  previewUrl: string;
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
  /** Whether the gallery is at the backend's per-product cap (the picker hides itself). */
  isFull: boolean;
}

let localIdCounter = 0;
/** Monotonic local id — enough for keys within one mount; survives same-name re-adds. */
const nextLocalId = (): string => `gallery-${++localIdCounter}`;

/** Two picks of the same underlying file (name+size+mtime) are one photo — silently a duplicate. */
const fingerprint = (file: File): string => `${file.name}|${file.size}|${file.lastModified}`;

/**
 * Owns the product-photo gallery state for the create form. Deliberately OUTSIDE react-hook-form:
 * `File` objects can't be drafted to sessionStorage (the silent-draft doctrine keeps drafts to the
 * serializable fields), and gallery validation is imperative (validate on add, not on submit).
 * The mirror contract still holds — count/type/size mirror `appConfig.storage`, and the backend
 * re-enforces every rule (the presign binds type+size into the signature; create caps the list).
 *
 * Preview URLs are `URL.createObjectURL` handles — revoked on remove and on unmount (never leaked).
 * The primary defaults to the FIRST photo and follows removals; `setPrimary` moves the star.
 */
export function useGalleryImages(): GalleryState {
  const { t } = useTranslation();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  // Unmount cleanup only — live revocation happens in removeImage. A ref mirror (updated in an
  // effect, never during render) lets the unmount effect see the latest list without re-running
  // (and revoking in-use URLs) on every change.
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(
    () => () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    },
    [],
  );

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      setError(undefined);
      const incoming = [...files];
      if (incoming.length === 0) return;

      setImages((current) => {
        const known = new Set(current.map((image) => fingerprint(image.file)));
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
      /* v8 ignore next -- defensive: the UI only ever passes ids of rendered images */
      if (removed) URL.revokeObjectURL(removed.previewUrl);
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

  return {
    images,
    primaryId,
    error,
    addFiles,
    removeImage,
    setPrimary,
    isFull: images.length >= PRODUCT_IMAGE_MAX_COUNT,
  };
}
