import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The drag hook has its own tests (pointer choreography with injected geometry); here it is
// mocked so the component's DRAG-STATE rendering (cursor/elevation classes, handler wiring) is
// controllable without forging pointer events.
const drag = vi.hoisted(() => ({
  draggingId: null as string | null,
  onPointerDown: vi.fn(),
}));
vi.mock('./useGalleryDrag', () => ({
  useGalleryDrag: () => ({
    draggingId: drag.draggingId,
    getThumbHandlers: () => ({
      onPointerDown: drag.onPointerDown,
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
    }),
  }),
}));

import ProductImageGallery from './ProductImageGallery';
import type { GalleryImage, GalleryState } from './useGalleryImages';

const KEY = 'modules.panel.products.create.gallery';

const image = (id: string, name = `${id}.png`): GalleryImage => ({
  id,
  file: new File(['x'], name, { type: 'image/png' }),
  name,
  previewUrl: `blob:${id}`,
});

const galleryState = (overrides: Partial<GalleryState> = {}): GalleryState => ({
  images: [],
  primaryId: null,
  error: undefined,
  addFiles: vi.fn(),
  removeImage: vi.fn(),
  setPrimary: vi.fn(),
  moveImage: vi.fn(),
  isFull: false,
  ...overrides,
});

const renderGallery = (
  gallery: GalleryState,
  props: Partial<{ disabled: boolean; progress: Record<string, number>; isUploading: boolean }> = {},
) =>
  render(
    <ProductImageGallery
      gallery={gallery}
      disabled={props.disabled ?? false}
      progress={props.progress ?? {}}
      isUploading={props.isUploading ?? false}
    />,
  );

const fileInput = (): HTMLInputElement =>
  document.querySelector('input[type="file"]') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  drag.draggingId = null;
});

describe('ProductImageGallery — empty state & picking', () => {
  it('shows the big dropzone when empty; clicking it opens the hidden picker', async () => {
    const gallery = galleryState();
    renderGallery(gallery);

    const input = fileInput();
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${KEY}.dropzone.cta`) }));
    expect(click).toHaveBeenCalled();
  });

  it('forwards picked files to addFiles and resets the input so re-picks fire again', () => {
    const gallery = galleryState();
    renderGallery(gallery);

    const input = fileInput();
    const file = image('a').file;
    fireEvent.change(input, { target: { files: [file] } });

    expect(gallery.addFiles).toHaveBeenCalledWith(expect.arrayContaining([file]));
    expect(input.value).toBe('');
  });

  it('never opens the picker while disabled', () => {
    renderGallery(galleryState(), { disabled: true });
    const click = vi.spyOn(fileInput(), 'click');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${KEY}.dropzone.cta`) }));
    expect(click).not.toHaveBeenCalled();
  });
});

describe('ProductImageGallery — drag & drop', () => {
  it('highlights on dragover and hands dropped files to addFiles', () => {
    const gallery = galleryState();
    const { container } = renderGallery(gallery);
    const zone = container.firstElementChild as HTMLElement;
    const dropzone = screen.getByRole('button', { name: new RegExp(`${KEY}.dropzone.cta`) });

    fireEvent.dragOver(zone);
    expect(dropzone.className).toContain('border-magenta');

    fireEvent.dragLeave(zone);
    expect(dropzone.className).not.toContain('border-magenta');

    const file = image('a').file;
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(gallery.addFiles).toHaveBeenCalledWith(expect.arrayContaining([file]));
  });

  it('ignores drags and drops while disabled', () => {
    const gallery = galleryState();
    const { container } = renderGallery(gallery, { disabled: true });
    const zone = container.firstElementChild as HTMLElement;

    fireEvent.dragOver(zone);
    expect(
      screen.getByRole('button', { name: new RegExp(`${KEY}.dropzone.cta`) }).className,
    ).not.toContain('border-magenta');

    fireEvent.drop(zone, { dataTransfer: { files: [image('a').file] } });
    expect(gallery.addFiles).not.toHaveBeenCalled();
  });

  it('ignores a drop when the gallery is full', () => {
    const gallery = galleryState({ images: [image('a')], primaryId: 'a', isFull: true });
    const { container } = renderGallery(gallery);
    fireEvent.drop(container.firstElementChild as HTMLElement, {
      dataTransfer: { files: [image('b').file] },
    });
    expect(gallery.addFiles).not.toHaveBeenCalled();
  });
});

describe('ProductImageGallery — thumbnails, the star, and removal', () => {
  const twoPhotos = () =>
    galleryState({ images: [image('a'), image('b')], primaryId: 'a' });

  it('renders a thumbnail per photo plus the add tile (which collapses at the cap)', () => {
    const { unmount } = renderGallery(twoPhotos());
    expect(screen.getAllByRole('listitem')).toHaveLength(3); // 2 photos + add tile
    expect(screen.getByRole('button', { name: `${KEY}.dropzone.cta` })).toBeInTheDocument();
    unmount();

    renderGallery(galleryState({ images: [image('a')], primaryId: 'a', isFull: true }));
    expect(screen.queryByRole('button', { name: `${KEY}.dropzone.cta` })).not.toBeInTheDocument();
  });

  it('marks the primary star pressed+disabled and lets the star move to another photo', async () => {
    const gallery = twoPhotos();
    renderGallery(gallery);

    const stars = screen.getAllByRole('button', { name: new RegExp(`${KEY}.actions.setPrimary`) });
    expect(stars[0]).toHaveAttribute('aria-pressed', 'true');
    expect(stars[0]).toBeDisabled();
    expect(stars[1]).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(stars[1]);
    expect(gallery.setPrimary).toHaveBeenCalledWith('b');
  });

  it('shows the "Principal" chip only on the starred photo', () => {
    renderGallery(twoPhotos());
    const chips = screen.getAllByText(`${KEY}.primaryBadge`);
    expect(chips[0].className).toContain('opacity-100');
    expect(chips[1].className).toContain('opacity-0');
  });

  it('removes a photo through its ✕ control', async () => {
    const gallery = twoPhotos();
    renderGallery(gallery);
    await userEvent.click(
      screen.getAllByRole('button', { name: new RegExp(`${KEY}.actions.removeImage`) })[0],
    );
    await vi.waitFor(() => expect(gallery.removeImage).toHaveBeenCalledWith('a'));
  });

  it('reflows (not boundary-swaps) when the grid grows within grid mode', () => {
    const first = galleryState({ images: [image('a')], primaryId: 'a' });
    const { rerender } = render(
      <ProductImageGallery gallery={first} disabled={false} progress={{}} isUploading={false} />,
    );
    // 1 → 2 photos: same grid mode on both sides — the in-grid FLIP path runs (instant in tests).
    rerender(
      <ProductImageGallery
        gallery={galleryState({ images: [image('a'), image('b')], primaryId: 'a' })}
        disabled={false}
        progress={{}}
        isUploading={false}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3); // 2 photos + add tile
  });

  it('ignores further remove clicks while a removal is already in flight', async () => {
    const gallery = twoPhotos();
    renderGallery(gallery);
    const buttons = screen.getAllByRole('button', { name: new RegExp(`${KEY}.actions.removeImage`) });
    // Two SYNCHRONOUS clicks — the second lands while the first thumb's exit tween is pending.
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await vi.waitFor(() => expect(gallery.removeImage).toHaveBeenCalledTimes(1));
    expect(gallery.removeImage).toHaveBeenCalledWith('a');
  });

  it('adds via the in-grid tile and freezes every control while disabled', () => {
    const gallery = twoPhotos();
    renderGallery(gallery, { disabled: true });

    for (const star of screen.getAllByRole('button', { name: new RegExp(`${KEY}.actions.setPrimary`) })) {
      expect(star).toBeDisabled();
    }
    for (const remove of screen.getAllByRole('button', { name: new RegExp(`${KEY}.actions.removeImage`) })) {
      expect(remove).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: `${KEY}.dropzone.cta` })).toBeDisabled();
  });
});

describe('ProductImageGallery — drag-to-reorder wiring', () => {
  const twoPhotos = () => galleryState({ images: [image('a'), image('b')], primaryId: 'a' });

  it('disables the browser image drag (the phantom-copy duplicate bug) and wires the pointer drag', () => {
    renderGallery(twoPhotos());

    // Native drag OFF: dragging a thumb must move the CARD, never spawn a phantom image copy
    // that the dropzone would re-add as a duplicate.
    for (const img of screen.getAllByRole('img')) {
      expect(img).toHaveAttribute('draggable', 'false');
    }

    // The card drag starts from the tile itself (the hook's pointerdown is attached to the li).
    fireEvent.pointerDown(screen.getAllByRole('listitem')[0]);
    expect(drag.onPointerDown).toHaveBeenCalled();
  });

  it('suppresses the long-press/right-click image menu on the tiles (a long press means "pick up")', () => {
    renderGallery(twoPhotos());
    const tile = screen.getAllByRole('listitem')[0];
    const prevented = !fireEvent.contextMenu(tile);
    expect(prevented).toBe(true);
  });

  it('elevates the tile in hand and swaps its cursor while dragging', () => {
    drag.draggingId = 'a';
    renderGallery(twoPhotos());

    const [tileA, tileB] = screen.getAllByRole('listitem');
    expect(tileA.className).toContain('cursor-grabbing');
    expect(tileA.className).toContain('shadow-xl');
    expect(tileB.className).not.toContain('shadow-xl');
    expect(tileB.className).toContain('cursor-grab');
  });

  it('says the reorder affordance out loud once there is something to reorder', () => {
    const { unmount } = renderGallery(twoPhotos());
    expect(screen.getByText(`${KEY}.reorderHint`)).toBeInTheDocument();
    unmount();

    // One photo (or none) → nothing to reorder → no hint.
    renderGallery(galleryState({ images: [image('a')], primaryId: 'a' }));
    expect(screen.queryByText(`${KEY}.reorderHint`)).not.toBeInTheDocument();
  });
});

describe('ProductImageGallery — upload progress & feedback', () => {
  it('dims uploading thumbnails and sizes each progress bar from its ratio', () => {
    const gallery = galleryState({ images: [image('a'), image('b')], primaryId: 'a' });
    renderGallery(gallery, { isUploading: true, progress: { a: 0.5 } });

    const img = screen.getByAltText('a.png');
    expect(img.className).toContain('opacity-50');

    const bars = document.querySelectorAll('span > span.bg-magenta');
    expect((bars[0] as HTMLElement).style.width).toBe('50%');
    expect((bars[1] as HTMLElement).style.width).toBe('0%'); // no progress event yet
  });

  it('renders the counter and surfaces the gallery error message', () => {
    renderGallery(galleryState({ error: 'errors.tooLarge' }));
    expect(screen.getByText(`${KEY}.counter`)).toBeInTheDocument();
    expect(document.getElementById('product-gallery-error')).toBeInTheDocument();
  });
});
