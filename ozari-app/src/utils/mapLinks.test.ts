import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMapsLink,
  buildMapsUrl,
  detectMapsPlatform,
  openMapsLink,
  orderDestination,
} from './mapLinks';

const COORDS = { lat: 14.634915, lng: -90.506883 };
const PIN = { kind: 'coords' as const, coords: COORDS };

describe('buildMapsUrl', () => {
  it('asks each app to NAVIGATE, not merely to display a point', () => {
    // Someone tapping this is about to drive; dropping the navigate flag would make them tap twice
    // more while holding a phone in a truck.
    expect(buildMapsUrl('google', PIN)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=14.634915,-90.506883&travelmode=driving',
    );
    expect(buildMapsUrl('waze', PIN)).toBe(
      'https://waze.com/ul?ll=14.634915,-90.506883&navigate=yes',
    );
    expect(buildMapsUrl('apple', PIN)).toBe(
      'https://maps.apple.com/?daddr=14.634915,-90.506883&dirflg=d',
    );
  });

  it('passes a PIN unencoded — a percent-encoded comma opened Waze with no destination', () => {
    // `,` is a legal sub-delimiter in a query and Waze's `ll` parser does not decode `%2C`: the app
    // launched, looked correct, and had nothing set. This is the whole iOS "the coords were lost"
    // report, and it is one character.
    for (const app of ['google', 'waze', 'apple'] as const) {
      expect(buildMapsUrl(app, PIN)).toContain('14.634915,-90.506883');
      expect(buildMapsUrl(app, PIN)).not.toContain('%2C');
    }
  });

  it('still encodes free TEXT, which really does contain spaces and separators', () => {
    const destination = { kind: 'query' as const, query: 'Zona 10, 4a avenida 5-55' };
    // Waze needs `q` here, not `ll`: handing a raw search string to `ll` silently lands elsewhere.
    expect(buildMapsUrl('waze', destination)).toBe(
      'https://waze.com/ul?q=Zona%2010%2C%204a%20avenida%205-55&navigate=yes',
    );
    expect(buildMapsUrl('google', destination)).toContain('destination=Zona%2010');
    expect(buildMapsUrl('apple', destination)).toContain('daddr=Zona%2010');
  });

  it('is always an https address — the app hand-off is a PLATFORM decision, not a scheme here', () => {
    for (const app of ['google', 'waze', 'apple'] as const) {
      expect(buildMapsUrl(app, PIN)).toMatch(/^https:\/\//u);
    }
  });
});

describe('detectMapsPlatform', () => {
  it.each([
    ['android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126'],
    ['ios', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15'],
    ['ios', 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15'],
    ['desktop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126'],
    ['desktop', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'],
  ])('reads %s from the user agent', (expected, userAgent) => {
    expect(detectMapsPlatform(userAgent)).toBe(expected);
  });

  it('files a touch-capable "Macintosh" as iOS — that is an iPad since iPadOS 13', () => {
    // Without this an iPad is treated as a desktop and gets a new tab that the maps app then
    // abandons: the `about:blank` bug, on the device where it is hardest to notice.
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    expect(detectMapsPlatform(ua, 5)).toBe('ios');
    // A real Mac reports 0 touch points.
    expect(detectMapsPlatform(ua, 0)).toBe('desktop');
  });
});

describe('buildMapsLink', () => {
  it('hands ANDROID an intent that launches the app, with the website as its fallback', () => {
    // A plain https link is what produced "this page wants to open…": the tab loads the WEBSITE and
    // the site then asks to hand off. An intent goes to the OS directly — and cannot fail silently,
    // because `S.browser_fallback_url` is followed when the app is not installed.
    const link = buildMapsLink('waze', PIN, 'android');
    expect(link.target).toBe('self');
    expect(link.url).toBe(
      'intent://waze.com/ul?ll=14.634915,-90.506883&navigate=yes#Intent;scheme=https;' +
        'package=com.waze;S.browser_fallback_url=' +
        encodeURIComponent('https://waze.com/ul?ll=14.634915,-90.506883&navigate=yes') +
        ';end',
    );
    expect(buildMapsLink('google', PIN, 'android').url).toContain(
      'package=com.google.android.apps.maps',
    );
  });

  it('gives Apple Maps on Android its website — there is no app to hand off to', () => {
    // An intent naming a package that cannot exist would only ever take the fallback, dressed up as
    // a hand-off.
    expect(buildMapsLink('apple', PIN, 'android')).toEqual({
      url: buildMapsUrl('apple', PIN),
      target: 'blank',
    });
  });

  it('navigates iOS in THIS tab, which is what leaves no about:blank behind', () => {
    // iOS resolves a universal link at navigation time; opening it with `window.open` left an empty
    // tab sitting behind the app that took over.
    for (const app of ['google', 'waze', 'apple'] as const) {
      expect(buildMapsLink(app, PIN, 'ios')).toEqual({
        url: buildMapsUrl(app, PIN),
        target: 'self',
      });
    }
  });

  it('leaves the DESKTOP exactly as it was: the website, in a new tab', () => {
    for (const app of ['google', 'waze', 'apple'] as const) {
      expect(buildMapsLink(app, PIN, 'desktop')).toEqual({
        url: buildMapsUrl(app, PIN),
        target: 'blank',
      });
    }
  });
});

describe('openMapsLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens a website in a new tab with noopener', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    openMapsLink({ url: 'https://waze.com/ul?ll=1,2', target: 'blank' });
    expect(open).toHaveBeenCalledWith('https://waze.com/ul?ll=1,2', '_blank', 'noopener,noreferrer');
  });

  it('performs a hand-off as a real ANCHOR ACTIVATION, and leaves no node behind', () => {
    // Both `intent://` and iOS universal links are documented against a link being followed; a
    // script-driven `location` assignment is the navigation a browser is most likely to second-guess.
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const clicked: (string | null)[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute('href'));
      // It has to be IN the document at the moment of the click, or the activation does nothing.
      expect(this.isConnected).toBe(true);
    });

    openMapsLink({ url: 'intent://waze.com/ul#Intent;end', target: 'self' });
    expect(clicked).toEqual(['intent://waze.com/ul#Intent;end']);
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('a')).toBeNull();
  });
});

describe('orderDestination', () => {
  it('is the pin, carrying the address as its human LABEL', () => {
    expect(orderDestination('Zona 10, 4a avenida', COORDS)).toEqual({
      kind: 'coords',
      coords: COORDS,
      label: 'Zona 10, 4a avenida',
    });
  });

  it('still returns the pin when there is no address to label it with', () => {
    expect(orderDestination(undefined, COORDS)).toEqual({ kind: 'coords', coords: COORDS });
  });

  it('is NOTHING without a pin — an address text is not a destination (owner rule 2026-08-04)', () => {
    // A walk-in address ("Test dirección", "Salón del club, entrada norte") is not reliably
    // geocodable, so searching it opens a maps app somewhere unrelated while looking exactly as
    // trustworthy as a real pin. Offering the button only when we can actually navigate makes its
    // presence itself the information.
    expect(orderDestination('Zona 10, 4a avenida', undefined)).toBeUndefined();
    expect(orderDestination(undefined, undefined)).toBeUndefined();
    expect(orderDestination('   ', undefined)).toBeUndefined();
  });
});
