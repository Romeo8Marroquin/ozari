import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HiChevronDown } from 'react-icons/hi2';
import CrossfadeImage from './CrossfadeImage';

export interface ImageSelectOption {
  value: number;
  label: string;
  /** The option's photo; absent/null = the brand placeholder. */
  imageUrl?: string | null;
}

interface ImageSelectProps {
  id: string;
  label: string;
  options: ImageSelectOption[];
  /** The picked option's value; `null` = nothing picked. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** An initial "nothing" row the user can move away from — and come back to, to clear. */
  placeholderOption?: string;
  error?: boolean;
  isRequired?: boolean;
  optionalLabel?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
  /** A GENUINE user engagement (a pointer press, a key) — the form wrapper's touched convention. */
  onEngage?: () => void;
  'aria-describedby'?: string;
}

/** Breathing room between the field and the list, and between the list and the window's edges. */
const GAP_PX = 8;
const EDGE_PX = 8;
/** ~5½ photo rows: the cut-off row says "there is more" without a scrollbar to read. */
const MAX_HEIGHT_PX = 352;
/** A phone-width field is narrower than a readable row with a photo; the list may be wider. */
const MIN_WIDTH_PX = 256;
/** Below this much room under the field, the list opens upward if there is more room there. */
const MIN_ROOM_BELOW_PX = 200;
/** The exit fade's length — the list stays mounted that long after closing so it can play. */
const EXIT_MS = 200;
/** Typed letters within this window build one search ("ca" → "CAMINO…"), like a native select. */
const TYPEAHEAD_MS = 600;
/** PageUp / PageDown step. */
const PAGE_STEP = 5;

interface Item {
  value: number | null;
  label: string;
  imageUrl?: string | null;
}

interface Placement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

/** Case- and accent-insensitive, so "nu" finds "NÚMEROS". */
const fold = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * A select whose options carry a PHOTO — the sibling of {@link CustomSelect} for choices people
 * recognise by sight (the order form's product picker). A native `<select>` cannot do this: only
 * Chromium's customizable picker renders content inside an option, and Safari/iOS and Firefox — the
 * phones especially — would show bare names. So this is the WAI-ARIA "select-only combobox": a real
 * `<button role="combobox">` wearing the field family's look (underline, floating label, rotating
 * chevron, error ink), and a `role="listbox"` popup.
 *
 * - **Focus never leaves the button** (`aria-activedescendant` names the highlighted row), so the
 *   form's touched/blur convention, RHF's focus-on-error and the label styles behave exactly as on a
 *   native select. The list swallows `mousedown` for the same reason.
 * - **Keyboard** is the native one: ↑/↓/Enter/Space open; ↑/↓/Home/End/PageUp/PageDown move;
 *   Enter/Space pick; Escape/Tab close; typed letters jump (accent-insensitive).
 * - **The popup** is the user menu's surface and motion (opacity + a short drop, `--ease-settle`),
 *   PORTALED to `<body>` at `--z-float-body` per the stacking doctrine, anchored under the field
 *   (above it when there is not room below), at least {@link MIN_WIDTH_PX} wide, kept inside the
 *   window, re-anchored on scroll/resize, dismissed by an outside press. It stays mounted through
 *   its exit fade, and only while open or leaving — the photos load when someone looks, not with
 *   the form. ⚠️ Inside a `Modal` it would need `--z-modal`-and-above; not used there today.
 */
const ImageSelect = forwardRef<HTMLButtonElement, ImageSelectProps>(
  (
    {
      id,
      label,
      options,
      value,
      onChange,
      placeholderOption,
      error = false,
      isRequired = false,
      optionalLabel = false,
      disabled = false,
      onBlur,
      onEngage,
      'aria-describedby': describedBy,
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const listboxId = useId();
    const labelId = `${id}-label`;
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
    const typeahead = useRef({ buffer: '', at: 0 });
    useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement, []);

    const [open, setOpen] = useState(false);
    const [present, setPresent] = useState(false);
    const [focused, setFocused] = useState(false);
    const [active, setActive] = useState(0);
    const [placement, setPlacement] = useState<Placement & { above: boolean }>({
      left: 0,
      width: MIN_WIDTH_PX,
      maxHeight: MAX_HEIGHT_PX,
      top: 0,
      above: false,
    });

    const items: Item[] =
      placeholderOption !== undefined ? [{ value: null, label: placeholderOption }, ...options] : options;
    const selectedIndex = items.findIndex((item) => item.value === value);
    const selected = selectedIndex === -1 ? undefined : items[selectedIndex];
    const isFilled = value !== null && selected !== undefined;
    const engaged = open || focused;

    // Mounted while open AND through the exit fade ("adjust state during render" for the mount, a
    // timer for the unmount — under reduced motion there is no fade, the wait is just invisible).
    if (open && !present) setPresent(true);
    useEffect(() => {
      if (open || !present) return undefined;
      const timer = window.setTimeout(() => setPresent(false), EXIT_MS);
      return () => window.clearTimeout(timer);
    }, [open, present]);

    const openList = (at?: number): void => {
      if (disabled) return;
      setActive(at ?? Math.max(selectedIndex, 0));
      setOpen(true);
      // Safari never focuses a clicked button; the whole keyboard model lives on it.
      triggerRef.current?.focus({ preventScroll: true });
    };
    const choose = (index: number): void => {
      setOpen(false);
      const item = items[index];
      /* v8 ignore next -- defensive: `active` always names a rendered row */
      if (!item) return;
      if (item.value !== value) onChange(item.value);
    };

    // Anchor under the field (above it when there is not room below and there is more up there),
    // clamped inside the window. Whole pixels: a fixed box on a sub-pixel boundary blurs its text.
    const place = useCallback(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      /* v8 ignore next -- the trigger is mounted whenever the list is */
      if (!rect) return;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.round(Math.min(Math.max(rect.width, MIN_WIDTH_PX), viewportWidth - 2 * EDGE_PX));
      const left = Math.round(Math.min(Math.max(rect.left, EDGE_PX), viewportWidth - EDGE_PX - width));
      const roomBelow = viewportHeight - rect.bottom - GAP_PX - EDGE_PX;
      const roomAbove = rect.top - GAP_PX - EDGE_PX;
      const above = roomBelow < MIN_ROOM_BELOW_PX && roomAbove > roomBelow;
      const maxHeight = Math.round(Math.min(MAX_HEIGHT_PX, above ? roomAbove : roomBelow));
      setPlacement(
        above
          ? { left, width, maxHeight, bottom: Math.round(viewportHeight - rect.top + GAP_PX), above }
          : { left, width, maxHeight, top: Math.round(rect.bottom + GAP_PX), above },
      );
    }, []);

    // While open: placed before the first paint, kept anchored on scroll (the panel's own scroller,
    // captured) and resize — but not on the list's OWN scroll, which moves nothing — and dismissed by
    // a press anywhere outside the field and the list.
    useLayoutEffect(() => {
      if (!open) return undefined;
      place();
      const onScroll = (event: Event): void => {
        const { target } = event;
        if (target instanceof Node && listRef.current?.contains(target)) return;
        place();
      };
      const onPointerDown = (event: PointerEvent): void => {
        const target = event.target as Node;
        if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
        setOpen(false);
      };
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', place);
      document.addEventListener('pointerdown', onPointerDown);
      return () => {
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', place);
        document.removeEventListener('pointerdown', onPointerDown);
      };
    }, [open, place]);

    // Keep the highlighted row in view: centred when the list OPENS (the picked product sits in the
    // middle, like a native picker), by the minimum afterwards (arrowing never jolts the list).
    const wasOpen = useRef(false);
    useLayoutEffect(() => {
      const justOpened = open && !wasOpen.current;
      wasOpen.current = open;
      const list = listRef.current;
      const row = optionRefs.current[active];
      if (!open || !list || !row) return;
      if (justOpened) {
        list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
      } else if (row.offsetTop < list.scrollTop) {
        list.scrollTop = row.offsetTop;
      } else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
      }
    }, [open, active]);

    /** The next row whose label starts with what was typed (the placeholder never matches). A
     *  single repeated letter cycles through that letter's rows, as a native select does. */
    const findTyped = (char: string, from: number): number | undefined => {
      const now = Date.now();
      const state = typeahead.current;
      state.buffer = now - state.at > TYPEAHEAD_MS ? char : state.buffer + char;
      state.at = now;
      const needle = fold(state.buffer);
      const start = state.buffer.length === 1 ? from + 1 : Math.max(from, 0);
      for (let step = 0; step < items.length; step += 1) {
        const index = (start + step) % items.length;
        const item = items[index];
        if (item.value !== null && fold(item.label).startsWith(needle)) return index;
      }
      return undefined;
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
      onEngage?.();
      const { key } = event;
      const typing = key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      // A space INSIDE a search ("camino de…") is a letter, not "pick".
      const searching = Date.now() - typeahead.current.at <= TYPEAHEAD_MS && typeahead.current.buffer !== '';
      if (!open) {
        if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
          event.preventDefault();
          openList();
        } else if (typing) {
          event.preventDefault();
          openList(findTyped(key, selectedIndex));
        }
        return;
      }
      const last = items.length - 1;
      const moves: Record<string, number> = {
        ArrowDown: Math.min(active + 1, last),
        ArrowUp: Math.max(active - 1, 0),
        Home: 0,
        End: last,
        PageDown: Math.min(active + PAGE_STEP, last),
        PageUp: Math.max(active - PAGE_STEP, 0),
      };
      if (Object.prototype.hasOwnProperty.call(moves, key)) {
        event.preventDefault();
        setActive(moves[key]);
      } else if (key === 'Enter' || (key === ' ' && !searching)) {
        event.preventDefault();
        choose(active);
      } else if (key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      } else if (key === 'Tab') {
        setOpen(false);
      } else if (typing) {
        event.preventDefault();
        const match = findTyped(key, active);
        if (match !== undefined) setActive(match);
      }
    };

    const floated = isFilled || engaged;
    const labelInk = disabled
      ? 'text-gray-disabled'
      : error
        ? 'text-red-600'
        : engaged
          ? 'text-midnight'
          : 'text-black';

    return (
      <div className="relative flex w-full min-w-0 items-center">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={labelId}
          aria-activedescendant={open ? `${listboxId}-${active}` : undefined}
          aria-invalid={error || undefined}
          aria-required={isRequired || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList())}
          onPointerDown={onEngage}
          onKeyDown={onKeyDown}
          // Activation by Space happens on keyup: the keydown already acted on it.
          onKeyUp={(event) => {
            if (event.key === ' ') event.preventDefault();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setOpen(false);
            onBlur?.();
          }}
          className={`w-full min-w-0 cursor-pointer border-b bg-transparent py-2 pl-2 pr-8 text-left text-md transition-colors duration-300 focus:outline-none disabled:cursor-not-allowed disabled:border-gray-disabled disabled:text-gray-disabled ${
            error ? 'border-red-600 text-red-600' : 'border-black text-black'
          }`}
        >
          {/* The placeholder text keeps the field's height; it is invisible until engaged, exactly
              like CustomSelect's empty value. */}
          <span
            className={`block truncate transition-colors duration-300 ${
              isFilled ? '' : engaged ? 'text-gray-disabled' : 'text-transparent'
            }`}
          >
            {selected?.label ?? placeholderOption ?? ' '}
          </span>
        </button>
        <label
          id={labelId}
          htmlFor={id}
          className={`pointer-events-none absolute left-2 max-w-[calc(100%-2.5rem)] origin-left truncate text-md transition-all duration-300 ${labelInk} ${
            floated ? '-translate-y-6 scale-75' : ''
          }`}
        >
          <span>{label}</span>
          {!optionalLabel && isRequired && (
            <>
              <span aria-hidden className="ml-[0.1rem]">
                {t('components.customInput.requiredField')}
              </span>
              <span className="sr-only"> ({t('components.customInput.requiredFieldLabel')})</span>
            </>
          )}
          {optionalLabel && !isRequired && (
            <span className="ml-[0.1rem]">{t('components.customInput.optionalField')}</span>
          )}
        </label>
        <HiChevronDown
          aria-hidden
          className={`pointer-events-none absolute right-2 size-4 transition-[rotate,color] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
            open ? 'rotate-180' : 'rotate-0'
          } ${error ? 'text-red-600' : engaged ? 'text-black' : 'text-gray-disabled'}`}
        />
        <hr
          aria-hidden
          className={`absolute bottom-0 left-0 h-0.5 w-full max-w-full origin-left border-none transition-[scale] duration-300 motion-reduce:transition-none ${
            error ? 'bg-red-600' : 'bg-midnight'
          } ${engaged ? 'scale-x-100' : 'scale-x-0'}`}
        />

        {present &&
          createPortal(
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-labelledby={labelId}
              inert={!open}
              // Keeps focus on the field: a press inside the list must not blur it.
              onMouseDown={(event) => event.preventDefault()}
              style={{
                left: placement.left,
                width: placement.width,
                maxHeight: placement.maxHeight,
                top: placement.top,
                bottom: placement.bottom,
              }}
              className={`fixed z-[var(--z-float-body)] flex flex-col overflow-y-auto overscroll-contain rounded-card border border-charcoal/[0.07] bg-white p-1.5 shadow-[0_10px_26px_-14px_rgba(38,38,38,0.30)] transition-[opacity,translate] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${
                open
                  ? `translate-y-0 opacity-100 starting:opacity-0 ${placement.above ? 'starting:translate-y-1' : 'starting:-translate-y-1'}`
                  : `pointer-events-none opacity-0 ${placement.above ? 'translate-y-1' : '-translate-y-1'}`
              }`}
            >
              {items.map((item, index) => {
                const isSelected = item.value === value;
                // The picked row reads by weight + full ink (no check column to shift the rows);
                // the "nothing" row stays muted unless it IS the pick.
                const ink = isSelected
                  ? 'font-semibold text-charcoal'
                  : item.value === null
                    ? 'text-charcoal/55'
                    : index === active
                      ? 'text-charcoal'
                      : 'text-charcoal/80';
                return (
                  <div
                    key={item.value ?? 'none'}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    id={`${listboxId}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    data-value={item.value ?? ''}
                    onPointerMove={() => {
                      if (index !== active) setActive(index);
                    }}
                    onClick={() => choose(index)}
                    className={`flex min-h-10 shrink-0 cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 text-sm transition-[background-color,color] duration-150 ${ink} ${
                      index === active ? 'bg-charcoal/[0.05]' : ''
                    }`}
                  >
                    {item.value !== null && (
                      <CrossfadeImage
                        src={item.imageUrl}
                        className="size-12 rounded-chip ring-1 ring-black/[0.04]"
                      />
                    )}
                    <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{item.label}</span>
                  </div>
                );
              })}
            </div>,
            document.body,
          )}
      </div>
    );
  },
);

export default ImageSelect;
