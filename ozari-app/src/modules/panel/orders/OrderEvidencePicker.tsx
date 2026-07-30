import { useLayoutEffect, useRef } from 'react';
import { HiOutlineCamera, HiOutlineXMark } from 'react-icons/hi2';
import Button from '@components/Button';
import {
  animateGalleryLayout,
  animateHeightFrom,
  animateThumbOut,
  captureGalleryLayout,
} from '../pageMotion';
import type { EvidencePhoto } from './evidencePhotos';

const SECONDARY_COLOR = '#262626';
/** The content types the storage policy accepts (the presign re-checks and binds them). */
const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp,image/avif';

interface OrderEvidencePickerProps {
  /** Names the picker — the visible label AND the off-screen input's accessible name. */
  label: string;
  /** Why the picker is there, said before the disabled confirm makes the person guess. */
  hint?: string;
  /** The pre-formatted "3 de 10 · mínimo 1" line. */
  countLabel: string;
  addLabel: string;
  removeLabel: (name: string) => string;
  photos: EvidencePhoto[];
  /** The step's own ceiling — the add button retires once it's reached. */
  max: number;
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (photoId: string) => void;
  /** Classes for the wrapper (the caller's own block/stagger vocabulary). */
  className?: string;
  /** Applied to EACH inner block — the advance dialog marks them `modal-stagger` so its open/close
   *  sweep cascades through them instead of moving the picker as one slab. */
  blockClassName?: string;
  /** Identity for a FLIP-choreographed parent list (the jump dialog's per-step pickers). */
  flipId?: string;
  /** Thumb-grid columns, so a wide dialog can show more per row. */
  gridClassName?: string;
}

/**
 * The photo-evidence picker — ONE implementation shared by both dialogs that collect evidence: the
 * single-step confirm (`OrderAdvanceModal`) and the admin's multi-step jump (`OrderStatusModal`,
 * which mounts one per demanding step). Sharing it is what guarantees the two feel identical; they
 * used to drift, and the jump dialog's copy was the abrupt one.
 *
 * The photos themselves are the caller's state (it owns validation and submission) — this component
 * owns the MOTION, which is why the handlers are wrapped rather than passed straight through: the
 * strip's layout is captured just BEFORE the caller commits, so the layout effect can replay the
 * difference. Adding eases the strip's height open while the tiles glide and the new ones bounce in;
 * removing shrinks the thumb out FIRST and only then closes the gap under it (the product gallery's
 * two-phase removal). Nothing below the picker ever jumps.
 */
const OrderEvidencePicker: React.FC<OrderEvidencePickerProps> = ({
  label,
  hint,
  countLabel,
  addLabel,
  removeLabel,
  photos,
  max,
  disabled,
  onAdd,
  onRemove,
  className,
  blockClassName,
  flipId,
  gridClassName = 'grid-cols-3 gap-2 sm:grid-cols-4',
}) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLDivElement>(null);
  const thumbs = useRef(new Map<string, HTMLElement>());
  /** Layout captured just BEFORE a photo is added/removed — replayed after the commit. */
  const pendingLayout = useRef<{
    state: ReturnType<typeof captureGalleryLayout>;
    fromHeight: number;
  } | null>(null);

  // Capture → commit → glide. Keyed on the photo IDS so it runs exactly once per real mutation (a
  // re-render with the same photos animates nothing).
  const photoKey = photos.map((photo) => photo.id).join(',');
  useLayoutEffect(() => {
    const captured = pendingLayout.current;
    if (!captured) return;
    pendingLayout.current = null;
    // The space is the animation: the strip's height eases from what it was, so everything below it
    // (the next step's picker, the reason field, the footer) slides instead of snapping.
    animateHeightFrom(gallery.current, captured.fromHeight);
    animateGalleryLayout(gallery.current, captured.state);
  }, [photoKey]);

  /** Snapshot the strip before it changes, so the layout effect can replay the difference. */
  const captureLayout = (): void => {
    const container = gallery.current;
    /* v8 ignore next -- the strip is mounted whenever a photo can be added or removed */
    if (!container) return;
    pendingLayout.current = {
      state: captureGalleryLayout(container),
      fromHeight: container.offsetHeight,
    };
  };

  const addFiles = (input: HTMLInputElement): void => {
    // Read the picked files BEFORE clearing the input (the reset empties its FileList, and the
    // caller's state updater runs later). Clearing is what lets the SAME file be re-picked after.
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (picked.length === 0) return;
    captureLayout();
    onAdd(picked);
  };

  /** The thumb shrinks out FIRST, then the row commits and the survivors glide into the gap. */
  const removePhoto = (id: string): void => {
    /* v8 ignore next -- a rendered tile always registered its element */
    const thumb = thumbs.current.get(id) ?? null;
    void animateThumbOut(thumb).then(() => {
      captureLayout();
      onRemove(id);
      thumbs.current.delete(id);
    });
  };

  // Resolved once: the jump dialog marks nothing (its whole picker is one FLIP block), the confirm
  // dialog marks every block so its open/close sweep cascades through them.
  const block = blockClassName ?? '';

  return (
    <div {...(flipId !== undefined && { 'data-flip-id': flipId })} className={className}>
      <div className={`${block} flex items-center justify-between gap-3`}>
        <span className="text-sm font-semibold text-charcoal/80">{label}</span>
        <span className="text-xs tabular-nums text-charcoal/45">{countLabel}</span>
      </div>
      {hint !== undefined && <p className={`${block} -mt-2 text-xs text-charcoal/50`}>{hint}</p>}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_IMAGES}
        multiple
        // `capture` is deliberately absent: the driver may shoot now OR pick a photo already taken
        // — quality of evidence over forcing the camera (EPIC-2 §8).
        className="sr-only"
        aria-label={label}
        onChange={(event) => addFiles(event.target)}
      />
      <div className={block}>
        <Button
          variant="soft"
          color={SECONDARY_COLOR}
          size="sm"
          fullWidth
          startIcon={<HiOutlineCamera className="size-4" />}
          disabled={disabled || photos.length >= max}
          onClick={() => fileInput.current?.click()}
        >
          {addLabel}
        </Button>
      </div>
      {/* The thumbnail strip — the photo IS the evidence, so it's shown, not named. This wrapper's
          height is what eases on add/remove (see the layout effect above). */}
      <div ref={gallery} className={block}>
        {photos.length > 0 && (
          <ul className={`grid ${gridClassName}`}>
            {photos.map((photo) => (
              <li
                key={photo.id}
                data-flip-id={photo.id}
                ref={(element) => {
                  if (element) thumbs.current.set(photo.id, element);
                }}
                className="gallery-flip group relative aspect-square overflow-hidden rounded-control bg-charcoal/[0.04] ring-1 ring-black/[0.04]"
              >
                <img src={photo.previewUrl} alt={photo.file.name} className="size-full object-cover" />
                <button
                  type="button"
                  aria-label={removeLabel(photo.file.name)}
                  disabled={disabled}
                  onClick={() => removePhoto(photo.id)}
                  className="absolute right-1 top-1 grid size-6 cursor-pointer place-items-center rounded-full bg-charcoal/60 text-white outline-none backdrop-blur-[2px] transition-[background-color,scale] duration-200 hover:bg-charcoal active:scale-95 focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                >
                  <HiOutlineXMark aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default OrderEvidencePicker;
