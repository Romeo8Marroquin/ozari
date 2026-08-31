import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKeys } from '@constants/StorageKeys';
import OpenInMapsButton from './OpenInMapsButton';

const DESTINATION = { kind: 'coords' as const, coords: { lat: 14.634915, lng: -90.506883 } };
const KEY = 'components.openInMaps';

let openSpy: ReturnType<typeof vi.fn>;
/** jsdom's own UA — restored after the Android case, or every later test would run as a phone. */
const REAL_USER_AGENT = navigator.userAgent;

beforeEach(() => {
  localStorage.clear();
  openSpy = vi.fn();
  vi.stubGlobal('open', openSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'userAgent', {
    value: REAL_USER_AGENT,
    configurable: true,
  });
});

describe('OpenInMapsButton', () => {
  it('ASKS the first time — guessing an app that may not be installed fails silently', async () => {
    const user = userEvent.setup();
    render(<OpenInMapsButton destination={DESTINATION} />);

    await user.click(screen.getByTestId('open-in-maps'));
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByText(`${KEY}.chooseTitle`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `${KEY}.apps.waze` }));
    expect(openSpy).toHaveBeenCalledWith(
      'https://waze.com/ul?ll=14.634915,-90.506883&navigate=yes',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('remembers the choice by default, so the next tap goes straight there', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OpenInMapsButton destination={DESTINATION} />);
    await user.click(screen.getByTestId('open-in-maps'));
    await user.click(screen.getByRole('button', { name: `${KEY}.apps.google` }));
    unmount();

    // A driver should never have to answer the same question twice on the same phone.
    render(<OpenInMapsButton destination={DESTINATION} />);
    await user.click(screen.getByTestId('open-in-maps'));
    expect(screen.queryByText(`${KEY}.chooseTitle`)).not.toBeInTheDocument();
    expect(openSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('google.com/maps/dir/'),
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('honours unchecking "remember" — a one-off choice stays a one-off', async () => {
    const user = userEvent.setup();
    render(<OpenInMapsButton destination={DESTINATION} />);
    await user.click(screen.getByTestId('open-in-maps'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: `${KEY}.apps.apple` }));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('maps.apple.com'),
      '_blank',
      'noopener,noreferrer',
    );
    expect(localStorage.getItem(StorageKeys.MAPS_APP)).toBeNull();
  });

  it('dismissing the chooser navigates nowhere and remembers nothing', async () => {
    const user = userEvent.setup();
    render(<OpenInMapsButton destination={DESTINATION} />);

    await user.click(screen.getByTestId('open-in-maps'));
    await user.click(screen.getByRole('button', { name: 'components.modal.close' }));
    expect(openSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(StorageKeys.MAPS_APP)).toBeNull();
  });

  it('opens in a NEW tab with noopener — the order must still be there on the way back', async () => {
    const user = userEvent.setup();
    localStorage.setItem(StorageKeys.MAPS_APP, JSON.stringify('google'));
    render(<OpenInMapsButton destination={{ kind: 'query', query: 'Zona 10' }} />);

    await user.click(screen.getByTestId('open-in-maps'));
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('destination=Zona%2010'),
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('hands ANDROID an intent instead of a tab, so the app opens with no interstitial', async () => {
    // The whole point of the platform split: on a phone this must not load a website that then asks
    // permission to hand off — it must go to the OS. The link's SHAPE is `mapLinks`' contract; what
    // is checked here is that the button reads the device at all.
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126',
      configurable: true,
    });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.href);
    });

    const user = userEvent.setup();
    localStorage.setItem(StorageKeys.MAPS_APP, JSON.stringify('waze'));
    render(<OpenInMapsButton destination={DESTINATION} />);
    await user.click(screen.getByTestId('open-in-maps'));

    expect(clicked[0]).toContain('intent://waze.com/ul?ll=14.634915,-90.506883');
    expect(clicked[0]).toContain('package=com.waze');
    // No stray tab — that is what left `about:blank` sitting behind the app.
    expect(openSpy).not.toHaveBeenCalled();
  });
});
