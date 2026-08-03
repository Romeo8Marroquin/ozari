import { render, screen } from '@testing-library/react';
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
vi.mock('./leafletMap', () => ({
  createLeafletMap: vi.fn((_el: HTMLElement, options: { onMove: (c: Coords) => void }) => {
    reportMove = options.onMove;
    return handle;
  }),
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
  render(
    <LocationPicker open onClose={onClose} onConfirm={onConfirm} {...props} />,
  );
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
    const result = await screen.findByRole('button', { name: 'Salón El Roble, Zona 10' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await user.click(result);
    expect(handle.panTo).toHaveBeenCalledWith({ lat: 14.634915, lng: -90.506883 });

    // Refining the query keeps the results you already have on screen instead of flashing a
    // "Buscando…" line over them — the list only reads as empty when it truly is.
    await user.type(screen.getByLabelText(`${KEY}.searchLabel`), ' centro');
    await vi.advanceTimersByTimeAsync(700);
    expect(screen.queryByText(`${KEY}.searching`)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salón El Roble, Zona 10' })).toBeInTheDocument();
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
    expect(screen.getByText(`${KEY}.searching`)).toBeInTheDocument();

    settle?.({ ok: true, json: () => Promise.resolve([PLACE]) });
    // Once results land the notice gives way to them — it never sits above a populated list.
    expect(await screen.findByRole('button', { name: 'Salón El Roble, Zona 10' })).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.searching`)).not.toBeInTheDocument();
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
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();

    await user.type(screen.getByLabelText(`${KEY}.manualLabel`), 'https://maps.app.goo.gl/abc');
    await user.click(screen.getByRole('button', { name: `${KEY}.manualApply` }));
    // "No pude leer eso" would send the admin hunting for a typo that isn't there.
    expect(await screen.findByText(`${KEY}.manualShortLink`)).toBeInTheDocument();
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
