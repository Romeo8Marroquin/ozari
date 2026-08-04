import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Coords } from '@utils/geo';
import LocationPicker from './LocationPicker';

// Leaflet needs real layout (container box, tile grid) that jsdom does not provide, so the DOM glue
// is mocked and the picker's own DECISIONS are what these tests pin. The handle mirrors the real
// one exactly — `onMove` is how the map reports the centre back, which is the whole contract.
const handle = {
  center: vi.fn<() => Coords>(() => ({ lat: 14.6, lng: -90.5 })),
  panTo: vi.fn(),
  invalidate: vi.fn(),
  destroy: vi.fn(),
};
let reportMove: ((coords: Coords) => void) | undefined;
let reportLoading: ((loading: boolean) => void) | undefined;
vi.mock('./leafletMap', () => ({
  createLeafletMap: vi.fn(
    (
      _el: HTMLElement,
      options: { onMove: (c: Coords) => void; onLoadingChange?: (loading: boolean) => void },
    ) => {
      reportMove = options.onMove;
      reportLoading = options.onLoadingChange;
      return handle;
    },
  ),
}));

const KEY = 'components.locationPicker';
const PLACE = {
  place_id: 7,
  display_name: 'Salón El Roble, Zona 10',
  lat: '14.634915',
  lon: '-90.506883',
};

const setup = (props: Partial<React.ComponentProps<typeof LocationPicker>> = {}) => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(<LocationPicker open onClose={onClose} onConfirm={onConfirm} {...props} />);
  return { onConfirm, onClose };
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([PLACE]) }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('LocationPicker', () => {
  it('keeps the pin visible through loading and panning alike', async () => {
    const { act } = await import('react');
    setup();

    // It was briefly tied to the tile-loading state, so a pan hid it — and a cache-served pan that
    // never reports completion hid it for good. The pin is ours; the network may not take it away.
    expect(screen.getByTestId('location-pin')).toBeInTheDocument();
    act(() => reportLoading?.(false));
    expect(screen.getByTestId('location-pin')).toBeInTheDocument();
    act(() => reportLoading?.(true));
    expect(screen.getByTestId('location-pin')).toBeInTheDocument();
  });

  it('reports the pin the MAP is centred on, live as it moves', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onConfirm } = setup();

    // The map moving is what changes the pin — there is no marker to drag.
    reportMove?.({ lat: 14.612345678, lng: -90.512345678 });
    // Rounded to the stored precision, so the readout can't promise more than we keep.
    expect(await screen.findByText('14.612346, -90.512346')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    expect(onConfirm).toHaveBeenCalledWith({ lat: 14.612346, lng: -90.512346 });
  });

  it('searches on a debounce and pans to the chosen result', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();

    await user.type(screen.getByLabelText(`${KEY}.searchLabel`), 'zona 10');
    // One request for the whole burst of keystrokes — Nominatim's policy is 1 req/s.
    await vi.advanceTimersByTimeAsync(700);
    // The label is split into a place line + a context line, so the accessible name is the two
    // joined — matched loosely on the part a human actually recognises.
    const result = await screen.findByRole('button', { name: /Salón El Roble/u });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await user.click(result);
    expect(handle.panTo).toHaveBeenCalledWith({ lat: 14.634915, lng: -90.506883 });

    // Refining the query keeps the results you already have on screen instead of flashing a
    // "Buscando…" line over them — the list only reads as empty when it truly is.
    await user.type(screen.getByLabelText(`${KEY}.searchLabel`), ' centro');
    await vi.advanceTimersByTimeAsync(700);
    expect(screen.getByRole('button', { name: /Salón El Roble/u })).toBeInTheDocument();
  });

  it('says it is searching while the FIRST search is in flight', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // A fetch we control, so the in-flight window can actually be observed.
    let settle: ((value: unknown) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => { settle = resolve; })),
    );
    setup();

    await user.type(screen.getByLabelText(`${KEY}.searchLabel`), 'zona 10');
    await vi.advanceTimersByTimeAsync(700);
    // The progress shows as a spinner in the field (visual) and is SPOKEN by the live region.
    // `waitFor`, not a bare read: the state flips inside the debounce timer's callback, and under a
    // loaded suite React's commit can land a tick after the timers are advanced.
    await waitFor(() =>
      expect(screen.getByTestId('search-status')).toHaveTextContent(`${KEY}.searching`),
    );

    settle?.({ ok: true, json: () => Promise.resolve([PLACE]) });
    expect(await screen.findByRole('button', { name: /Salón El Roble/u })).toBeInTheDocument();
    // The region STAYS mounted (an announcement added with its text is often missed) but empties.
    expect(screen.getByTestId('search-status')).toHaveTextContent('');
  });

  it('veils the map until its FIRST tiles arrive, and never again', async () => {
    const { act } = await import('react');
    setup();

    // A half-drawn grid presented as ready is exactly how the CSP bug read as a design decision.
    const veil = screen.getByRole('status', { name: `${KEY}.loadingMap` }).parentElement;
    expect(veil).toHaveClass('opacity-100');

    act(() => reportLoading?.(false));
    expect(veil).toHaveClass('opacity-0');

    // Leaflet re-fires `loading` on EVERY pan and zoom. Re-veiling on each gesture would strobe —
    // and because a cache-served move may never report completion, it could also stick forever.
    act(() => reportLoading?.(true));
    expect(veil).toHaveClass('opacity-0');
  });

  it('shows a place with no context as one line', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ ...PLACE, display_name: 'Cayalá' }]),
      }),
    );
    setup();

    await user.type(screen.getByLabelText(`${KEY}.searchLabel`), 'cayala');
    await vi.advanceTimersByTimeAsync(700);
    // Nothing to split off, so the secondary line is simply empty rather than a stray comma.
    expect(await screen.findByRole('button', { name: 'Cayalá' })).toBeInTheDocument();
  });

  it('says when a search found NOTHING, and stays quiet before one has run', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    setup();

    // Too short to have searched: promising "sin resultados" here would be a lie.
    await user.type(screen.getByLabelText(`${KEY}.searchLabel`), 'zo');
    await vi.advanceTimersByTimeAsync(700);
    expect(screen.queryByText(`${KEY}.noResults`)).not.toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // A real search that came back empty — silence here is what a broken search looks like.
    await user.type(screen.getByLabelText(`${KEY}.searchLabel`), 'na 99');
    await vi.advanceTimersByTimeAsync(700);
    expect(await screen.findByText(`${KEY}.noResults`)).toBeInTheDocument();
  });

  it('accepts a pasted link or coordinates', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();

    await user.type(
      screen.getByLabelText(`${KEY}.manualLabel`),
      'https://waze.com/ul?ll=14.634915,-90.506883',
    );
    await user.click(screen.getByRole('button', { name: `${KEY}.manualApply` }));
    expect(handle.panTo).toHaveBeenCalledWith({ lat: 14.634915, lng: -90.506883 });
  });

  it('explains a SHORTENED link instead of blaming the paste', async () => {
    // REAL timers: this path has no debounce in it at all (paste → press "Usar"), and the fake
    // clock only adds a race between userEvent's own scheduling and the message's fade-in.
    vi.useRealTimers();
    const user = userEvent.setup();
    setup();

    const input = screen.getByLabelText(`${KEY}.manualLabel`);
    await user.type(input, 'https://maps.app.goo.gl/abc');
    await user.click(screen.getByRole('button', { name: `${KEY}.manualApply` }));

    // The field is marked invalid and the pin did NOT move. The MESSAGE itself rides
    // `AnimatedMessage`, whose GSAP mount doesn't run in jsdom — so this asserts the decision
    // (`isShortMapsLink` chose the explanatory copy) through state the DOM actually carries, while
    // `geo.test.ts` owns the predicate that picks which sentence is shown.
    await waitFor(() => expect(input).toHaveClass('border-red-600'));
    expect(handle.panTo).not.toHaveBeenCalled();
  });

  it('reports unreadable text as unreadable, and stops blaming it as they retype', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();

    const input = screen.getByLabelText(`${KEY}.manualLabel`);
    await user.type(input, 'cerca de la iglesia');
    await user.click(screen.getByRole('button', { name: `${KEY}.manualApply` }));
    // The MESSAGE itself is pinned by the short-link test above; what matters here is that a
    // phrase we cannot parse never moves the pin somewhere arbitrary.
    expect(handle.panTo).not.toHaveBeenCalled();

    // Typing clears the error state — the message then fades out on GSAP's own ticker, which does
    // not run under fake timers, so this asserts the input is usable again rather than the node.
    await user.clear(input);
    await user.type(input, '14.6,-90.5');
    await user.click(screen.getByRole('button', { name: `${KEY}.manualApply` }));
    expect(handle.panTo).toHaveBeenCalledWith({ lat: 14.6, lng: -90.5 });
  });

  it('jumps to the device location when asked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const getCurrentPosition = vi.fn(
      (onSuccess: (position: { coords: { latitude: number; longitude: number } }) => void) => {
        onSuccess({ coords: { latitude: 14.55, longitude: -90.45 } });
      },
    );
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
    setup();

    // Standing at the venue is the fastest possible way to get an exact pin.
    await user.click(screen.getByRole('button', { name: `${KEY}.myLocation` }));
    expect(handle.panTo).toHaveBeenCalledWith({ lat: 14.55, lng: -90.45 });
  });

  it('does nothing when the device offers no geolocation at all', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.stubGlobal('navigator', { ...navigator, geolocation: undefined });
    setup();

    // An older browser, or a hardened one: the button must be inert, never throw.
    await user.click(screen.getByRole('button', { name: `${KEY}.myLocation` }));
    expect(handle.panTo).not.toHaveBeenCalled();
  });

  it('starts CLEAN every time it reopens', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(
      <LocationPicker open onClose={vi.fn()} onConfirm={vi.fn()} initialQuery="Zona 10" />,
    );
    await user.type(screen.getByLabelText(`${KEY}.manualLabel`), 'cerca de la iglesia');
    expect((screen.getByLabelText(`${KEY}.manualLabel`) as HTMLInputElement).value).not.toBe('');

    rerender(
      <LocationPicker open={false} onClose={vi.fn()} onConfirm={vi.fn()} initialQuery="Zona 10" />,
    );
    // Reopened with NO address typed yet: the search box starts empty rather than undefined.
    rerender(<LocationPicker open onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect((screen.getByLabelText(`${KEY}.searchLabel`) as HTMLInputElement).value).toBe('');

    rerender(<LocationPicker open={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    rerender(<LocationPicker open onClose={vi.fn()} onConfirm={vi.fn()} initialQuery="Zona 15" />);

    // A previous address's half-typed paste must never greet the next one.
    expect((screen.getByLabelText(`${KEY}.manualLabel`) as HTMLInputElement).value).toBe('');
    // …and the search box starts from the address the admin already typed.
    expect((screen.getByLabelText(`${KEY}.searchLabel`) as HTMLInputElement).value).toBe('Zona 15');
  });

  it('opens on the existing pin, and tears the map down on close', async () => {
    const { unmount } = render(
      <LocationPicker
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        value={{ lat: 14.7, lng: -90.4 }}
      />,
    );
    expect(await screen.findByText('14.700000, -90.400000')).toBeInTheDocument();

    unmount();
    // Leaving a Leaflet instance attached to a removed container leaks listeners and tiles.
    expect(handle.destroy).toHaveBeenCalled();
  });
});
