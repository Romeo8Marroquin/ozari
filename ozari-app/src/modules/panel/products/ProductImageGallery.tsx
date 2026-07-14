import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiMiniStar, HiOutlinePhoto, HiOutlinePlus, HiOutlineXMark } from 'react-icons/hi2';
import AnimatedMessage from '@components/AnimatedMessage';
import { PRODUCT_IMAGE_MAX_COUNT } from '@constants/Regex';
import {
  animateGalleryBoundary,
  animateGalleryLayout,
  animateThumbOut,
  captureGalleryLayout,
} from '../pageMotion';
import type { GalleryState } from './useGalleryImages';

const KEY = 'modules.panel.products.create.gallery';

interface ProductImageGalleryProps {
  gallery: GalleryState;
  /** True while the form is submitting/uploading — freezes every gallery control. */
  disabled: boolean;
  /** Per-image upload ratio (0..1) keyed by local image id, shown as a bottom progress bar. */
  progress: Record<string, number>;
  /** True while the files are PUTting to R2 — dims the thumbnails under their progress bars. */
  isUploading: boolean;
}

/**
 * The create-form photo gallery: a drag-&-drop / click picker plus a thumbnail grid where ONE photo
 * wears the star — the **primary** shown on the product card (`ProductCard` renders `images[0]`,
 * which the backend orders primary-first). The first photo takes the star by default; clicking the
 * star on any other thumbnail moves it (the "Principal" chip glides along via CSS transitions —
 * binary state, so CSS owns it per the motion division rule). All controls freeze while disabled.
 *
 * Grid mutations are FLIPped (`pageMotion`): the layout is captured BEFORE an add/remove commits,
 * then surviving tiles glide to their new cells while new photos bounce in softly — space is
 * opened and closed smoothly, never snapped. A removal is two-phase: the thumb tweens out first,
 * then the survivors reflow.
 */
const ProductImageGallery: React.FC<ProductImageGalleryProps> = ({
  gallery,
  disabled,
  progress,
  isUploading,
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  // The SWAP container: holds whichever view is mounted (empty dropzone | grid). Its height is
  // what eases across the empty ↔ grid boundary; it's also the FLIP scope for in-grid reflows.
  const swapRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef(new Map<string, HTMLLIElement>());
  // Snapshots taken in the mutation handlers, consumed by the post-commit effect below.
  const pendingLayout = useRef<ReturnType<typeof captureGalleryLayout>>(null);
  const pendingHeight = useRef(0);
  const removingRef = useRef<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const { images, primaryId, error, addFiles, removeImage, setPrimary, isFull } = gallery;

  const captureBefore = (): void => {
    pendingLayout.current = captureGalleryLayout(swapRef.current);
    /* v8 ignore next -- `?? 0`: defensive; the swap container is always mounted here */
    pendingHeight.current = swapRef.current?.offsetHeight ?? 0;
  };

  // The gallery changed size → crossing the empty ↔ grid boundary eases the container height while
  // the incoming view settles in; an in-grid change FLIPs the tiles from the captured layout.
  const prevCount = useRef(images.length);
  useLayoutEffect(() => {
    if (images.length !== prevCount.current) {
      const crossedEmptyBoundary = (prevCount.current === 0) !== (images.length === 0);
      if (crossedEmptyBoundary) {
        animateGalleryBoundary(swapRef.current, pendingHeight.current);
      } else {
        animateGalleryLayout(swapRef.current, pendingLayout.current);
      }
    }
    prevCount.current = images.length;
    pendingLayout.current = null;
  }, [images]);

  const openPicker = (): void => {
    /* v8 ignore next -- `?.`: the ref is always attached while the component is mounted */
    if (!disabled) inputRef.current?.click();
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    captureBefore();
    /* v8 ignore next -- `?? []`: defensive; a change event always carries a FileList */
    addFiles(event.target.files ?? []);
    // Reset so re-picking the same file fires `change` again (the duplicate guard speaks, not silence).
    event.target.value = '';
  };

  const onDragOver = (event: React.DragEvent): void => {
    event.preventDefault();
    if (!disabled && !isFull) setDragActive(true);
  };

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    setDragActive(false);
    if (disabled || isFull) return;
    captureBefore();
    addFiles(event.dataTransfer.files);
  };

  // Two-phase removal: the thumb shrinks away in place, THEN the state commit reflows the
  // survivors from the captured layout. A ref (not state) guards re-entry synchronously.
  const handleRemove = (id: string): void => {
    if (removingRef.current !== null) return;
    removingRef.current = id;
    /* v8 ignore next -- `?? null`: defensive; a rendered thumb always has its element registered */
    void animateThumbOut(thumbRefs.current.get(id) ?? null).then(() => {
      captureBefore();
      removeImage(id);
      removingRef.current = null;
    });
  };

  const dropzoneRing = dragActive
    ? 'border-magenta bg-magenta/[0.04]'
    : 'border-charcoal/20 hover:border-charcoal/40 hover:bg-charcoal/[0.02]';

  // The tile CONTROLS (star + ✕): permanently visible on touch (there is no hover to reveal them),
  // hover/focus-revealed only on fine pointers — capability, not viewport width, decides. Both wear
  // IDENTICAL transitions so they appear/disappear together, never staggered.
  const controlReveal =
    'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100';
  const controlMotion =
    'transition-[opacity,scale,color,box-shadow] duration-200 ease-[var(--ease-settle)]';

  return (
    <div
      className="flex flex-col gap-4"
      onDragOver={onDragOver}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={onInputChange}
      />

      {/* The swap container: its HEIGHT is the boundary animation (empty dropzone ⇄ grid). */}
      <div ref={swapRef}>
      {images.length === 0 ? (
        /* Empty state: one generous drop surface — the section's whole first impression. */
        <button
          type="button"
          disabled={disabled}
          onClick={openPicker}
          className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-control border-2 border-dashed px-6 py-10 text-center transition-[color,background-color,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta disabled:cursor-not-allowed disabled:opacity-60 ${dropzoneRing}`}
        >
          <HiOutlinePhoto aria-hidden className="size-8 text-charcoal/35" />
          <span className="text-sm font-medium text-charcoal/70">{t(`${KEY}.dropzone.cta`)}</span>
          <span className="text-xs text-charcoal/45">{t(`${KEY}.dropzone.hint`)}</span>
        </button>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" role="list">
          {images.map((image) => {
            const isPrimary = image.id === primaryId;
            const ratio = progress[image.id] ?? 0;
            return (
              <li
                key={image.id}
                ref={(el) => {
                  if (el) thumbRefs.current.set(image.id, el);
                  else thumbRefs.current.delete(image.id);
                }}
                className="gallery-flip group relative aspect-square overflow-hidden rounded-control bg-charcoal/[0.04] ring-1 ring-black/[0.06]"
              >
                <img
                  src={image.previewUrl}
                  alt={image.file.name}
                  className={`size-full object-cover transition-opacity duration-200 ${isUploading ? 'opacity-50' : 'opacity-100'}`}
                />

                {/* The star = the primary control AND indicator: filled amber on the current
                    primary; on the rest it appears on hover/focus so the grid stays calm. */}
                <button
                  type="button"
                  disabled={disabled || isPrimary}
                  onClick={() => setPrimary(image.id)}
                  aria-pressed={isPrimary}
                  aria-label={t(`${KEY}.actions.setPrimary`, { name: image.file.name })}
                  title={isPrimary ? t(`${KEY}.primaryBadge`) : t(`${KEY}.actions.setPrimaryShort`)}
                  className={`absolute left-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-white/85 shadow-sm backdrop-blur ${controlMotion} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta ${
                    isPrimary
                      ? 'scale-100 text-amber-500 opacity-100'
                      : `cursor-pointer text-charcoal/40 opacity-100 hover:scale-110 hover:text-amber-500 ${controlReveal}`
                  } disabled:cursor-default`}
                >
                  <HiMiniStar aria-hidden className="size-4" />
                </button>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handleRemove(image.id)}
                  aria-label={t(`${KEY}.actions.removeImage`, { name: image.file.name })}
                  className={`absolute right-1.5 top-1.5 grid size-7 cursor-pointer place-items-center rounded-full bg-white/85 text-charcoal/50 opacity-100 shadow-sm backdrop-blur ${controlMotion} hover:scale-110 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta disabled:cursor-not-allowed ${controlReveal}`}
                >
                  <HiOutlineXMark aria-hidden className="size-4" />
                </button>

                {/* "Principal" chip: fades/lifts in as the star lands on this photo. */}
                <span
                  aria-hidden
                  className={`pointer-events-none absolute bottom-1.5 left-1.5 rounded-chip bg-white/85 px-1.5 py-0.5 text-[10px] font-semibold text-charcoal/75 shadow-sm backdrop-blur transition-all duration-200 ease-[var(--ease-settle)] ${
                    isPrimary ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                  }`}
                >
                  {t(`${KEY}.primaryBadge`)}
                </span>

                {/* Upload progress: a slim bottom bar while the file PUTs to R2. */}
                {isUploading && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-1 bg-charcoal/10"
                  >
                    <span
                      className="block h-full bg-magenta transition-[width] duration-200 ease-out"
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </span>
                )}
              </li>
            );
          })}

          {/* The add tile keeps growing the gallery from inside the grid; it collapses at the cap.
              It glides to its next cell via the same FLIP as the thumbs. */}
          {!isFull && (
            <li className="gallery-flip">
              <button
                type="button"
                disabled={disabled}
                onClick={openPicker}
                aria-label={t(`${KEY}.dropzone.cta`)}
                className={`flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-control border-2 border-dashed transition-[color,background-color,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta disabled:cursor-not-allowed disabled:opacity-60 ${dropzoneRing}`}
              >
                <HiOutlinePlus aria-hidden className="size-5 text-charcoal/40" />
                <span className="text-[11px] font-medium text-charcoal/50">
                  {t(`${KEY}.dropzone.add`)}
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
      </div>

      <div className="flex items-start justify-between gap-3">
        <AnimatedMessage id="product-gallery-error" errorMessage={error} />
        <span className="shrink-0 text-xs text-charcoal/45">
          {t(`${KEY}.counter`, { count: images.length, max: PRODUCT_IMAGE_MAX_COUNT })}
        </span>
      </div>
    </div>
  );
};

export default ProductImageGallery;
