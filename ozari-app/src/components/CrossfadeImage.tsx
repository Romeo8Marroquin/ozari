import { useEffect, useState } from 'react';
import { HiOutlinePhoto } from 'react-icons/hi2';
import { twMerge } from 'tailwind-merge';
import LogoMark from './LogoMark';

/** The fade's length — also when the layers a finished fade covers are dropped. */
const FADE_MS = 300;

/** What a layer paints: a photo, the brand placeholder (something chosen, no photo), or the quiet
 *  EMPTY tile (nothing chosen yet). */
type LayerKind = 'photo' | 'brand' | 'empty';

interface Layer {
  id: number;
  /** `photo:<url>` / `brand` / `empty` — a change of identity is a new layer. */
  identity: string;
  kind: LayerKind;
  src?: string;
  /** Painted at full opacity. A photo flips this only once it has DECODED, so a slow image never
   *  fades in as an empty box; a placeholder is shown from its first frame (`starting:` fades it). */
  shown: boolean;
}

const identityOf = (src: string | null | undefined, empty: boolean): string =>
  src ? `photo:${src}` : empty ? 'empty' : 'brand';

const layerFor = (id: number, src: string | null | undefined, empty: boolean): Layer => {
  if (src) return { id, identity: identityOf(src, empty), kind: 'photo', src, shown: false };
  return { id, identity: identityOf(src, empty), kind: empty ? 'empty' : 'brand', shown: true };
};

interface CrossfadeImageProps {
  /** The photo to show; absent = a placeholder (which one is `empty`'s call). */
  src?: string | null;
  /** With no `src`: `true` paints the quiet EMPTY tile (nothing chosen), `false` the brand mark
   *  (something chosen that has no photo — the catalog tile's own placeholder). */
  empty?: boolean;
  /** The box — size, radius, ring. Its contents always cover it. */
  className?: string;
}

/**
 * A small photo box that never CUTS from one picture to the next. Each new picture is a layer laid
 * over the current one at zero opacity; it fades in once it has actually loaded (a photo) or at once
 * (a placeholder, via `@starting-style`), and only when that fade has finished are the layers it
 * covers dropped — so a change of photo, a photo appearing over the empty tile, or the box going back
 * to empty is always a cross-fade, never a blink or a flash of the box's background. A failed photo
 * becomes the brand placeholder rather than a broken-image glyph.
 *
 * Binary per layer and CSS-owned (opacity only), per the motion division rule; reduced motion turns
 * the fades off and the layers simply replace one another. DECORATIVE: the name of whatever it
 * pictures is always printed beside it, so it carries no alt text and is hidden from the a11y tree.
 */
const CrossfadeImage: React.FC<CrossfadeImageProps> = ({ src, empty = false, className }) => {
  const [layers, setLayers] = useState<Layer[]>(() => [layerFor(0, src, empty)]);
  const top = layers[layers.length - 1];
  const identity = identityOf(src, empty);

  // A new picture → a new layer on top ("adjust state during render": compared against the TOP's
  // identity, so it converges in one extra pass). Going BACK to the picture right underneath a
  // layer that never got to show (a quick there-and-back) just drops that layer — nothing to fade.
  if (top.identity !== identity) {
    const below = layers[layers.length - 2];
    if (below?.identity === identity && !top.shown) setLayers(layers.slice(0, -1));
    else setLayers([...layers, layerFor(top.id + 1, src, empty)]);
  }

  // Once the top layer is fully in, what it covers is invisible — drop it after the fade. A newer
  // layer arriving first cancels this; ITS fade then clears everything below it.
  useEffect(() => {
    if (!top.shown || layers.length === 1) return undefined;
    const timer = window.setTimeout(
      () => setLayers((current) => current.filter((layer) => layer.id >= top.id)),
      FADE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [top.id, top.shown, layers.length]);

  // Returning the SAME array when nothing changes keeps a repeated load signal (the ref check + the
  // event both firing) from re-rendering.
  const settle = (id: number, failed: boolean): void =>
    setLayers((current) =>
      current.some((layer) => layer.id === id && !layer.shown)
        ? current.map((layer) =>
            layer.id === id ? { ...layer, shown: true, ...(failed && { kind: 'brand' as const }) } : layer,
          )
        : current,
    );

  return (
    <span aria-hidden className={twMerge('relative block shrink-0 overflow-hidden', className)}>
      {layers.map((layer) => (
        <span
          key={layer.id}
          data-layer={layer.kind}
          className={`absolute inset-0 transition-opacity duration-300 ease-in-out motion-reduce:transition-none ${
            layer.shown ? 'opacity-100 starting:opacity-0' : 'opacity-0'
          }`}
        >
          {layer.kind === 'photo' ? (
            <img
              src={layer.src}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              // A photo already in the cache can finish before React wires `onLoad`; the ref
              // catches that case so it is never stuck invisible.
              ref={(element) => {
                if (element?.complete && element.naturalWidth > 0) settle(layer.id, false);
              }}
              onLoad={() => settle(layer.id, false)}
              onError={() => settle(layer.id, true)}
              className="size-full object-cover"
            />
          ) : layer.kind === 'brand' ? (
            <span className="grid size-full place-items-center bg-gradient-to-br from-cream to-blossom text-charcoal/25">
              <LogoMark className="size-1/2" />
            </span>
          ) : (
            <span className="grid size-full place-items-center bg-charcoal/[0.04] text-charcoal/25">
              <HiOutlinePhoto className="size-2/5" />
            </span>
          )}
        </span>
      ))}
    </span>
  );
};

export default CrossfadeImage;
