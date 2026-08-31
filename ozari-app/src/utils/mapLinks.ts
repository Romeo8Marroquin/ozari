import type { Coords } from './geo';

/**
 * NAVIGATION IS ALWAYS SOMEBODY ELSE'S APP.
 *
 * We never build turn-by-turn: the driver already has a maps app they trust, with their own traffic
 * data, voice and offline tiles. Our job is to hand it the destination and get out of the way.
 *
 * **The web cannot launch a native app by permission — only by ADDRESS.** There is no API to ask
 * for, so "open the app directly" is entirely a question of handing the browser a URL whose
 * handling it already delegates to the OS. There are exactly two such mechanisms, and this module
 * picks between them per platform ({@link buildMapsLink}):
 *
 * - **Android — an `intent://` URL.** Chrome hands it straight to the OS: the app opens with no
 *   interstitial and no tab. `S.browser_fallback_url` is what makes this safe — when the app is NOT
 *   installed the browser follows the https link instead, so the old "fails silently" objection to
 *   custom schemes does not apply. A plain https link is what produced the "this page wants to
 *   open…" prompt: the tab loads the WEBSITE, and the site then asks to hand off.
 * - **iOS — the vendor's universal link, navigated in THIS tab.** iOS decides at navigation time
 *   whether an https URL belongs to an installed app. Opening it with `window.open` is what left an
 *   `about:blank` tab behind after the app took over, so a hand-off is a same-tab navigation.
 *
 * A desktop has no app to open, so it keeps the https link in a new tab — the behaviour that
 * already works there, deliberately untouched.
 *
 * ⚠️ **A `lat,lng` pair is passed UNENCODED.** `,` is a legal sub-delimiter in a query, and Waze's
 * `ll` parser does not decode `%2C` — a percent-encoded pair opened the app with no destination at
 * all, which is exactly the "it opens Waze but nothing is set" report. Only free TEXT is encoded.
 */
export const MAPS_APPS = ['google', 'waze', 'apple'] as const;
export type MapsApp = (typeof MAPS_APPS)[number];

/** What the user picked in Settings. `ask` = no default yet; the button offers the choice. */
export type MapsAppPreference = MapsApp | 'ask';

/**
 * Where we're sending them. A pin when the order has one, otherwise the address TEXT — which is the
 * whole reason this takes a union: most walk-in orders will never have a pin, and "open in maps"
 * must still work for them by handing the app a search query.
 */
export type MapsDestination =
  | { kind: 'coords'; coords: Coords; label?: string | undefined }
  | { kind: 'query'; query: string };

/**
 * What each app is pointed at, ready to drop into a query.
 *
 * A PIN goes in verbatim: `14.634915,-90.506883` is made entirely of characters a query may carry,
 * and encoding the comma broke Waze outright (see the module note). Free TEXT is encoded, because
 * an address genuinely contains spaces and `&`.
 */
const targetOf = (destination: MapsDestination): string =>
  destination.kind === 'coords'
    ? `${destination.coords.lat},${destination.coords.lng}`
    : encodeURIComponent(destination.query);

/**
 * The https link for one app and one destination — the WEBSITE address, which every platform
 * understands and which doubles as the Android fallback.
 *
 * Each is the vendor's DOCUMENTED navigation entry point, and each is asked to start navigating
 * rather than just to display a point — a driver tapping this is about to drive, not browse:
 * - Google: the Maps URLs API `dir/?api=1&destination=…&travelmode=driving`.
 * - Waze: `waze.com/ul?…&navigate=yes` (its universal link).
 * - Apple: `maps.apple.com/?daddr=…&dirflg=d` (`daddr` = destination address).
 */
export function buildMapsUrl(app: MapsApp, destination: MapsDestination): string {
  const target = targetOf(destination);
  switch (app) {
    case 'waze':
      // Waze takes `ll` for a raw pin and `q` for a search — mixing them up silently searches for
      // the literal string "14.63,-90.50", which lands somewhere unrelated.
      return destination.kind === 'coords'
        ? `https://waze.com/ul?ll=${target}&navigate=yes`
        : `https://waze.com/ul?q=${target}&navigate=yes`;
    case 'apple':
      return `https://maps.apple.com/?daddr=${target}&dirflg=d`;
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${target}&travelmode=driving`;
  }
}

/** Which hand-off mechanism the device understands. `desktop` covers everything with no maps app. */
export type MapsPlatform = 'android' | 'ios' | 'desktop';

/**
 * The platform, from the user agent.
 *
 * `maxTouchPoints` is the iPad tell: since iPadOS 13 an iPad reports itself as `Macintosh`, so a
 * UA sniff alone files it as a desktop and it would get a new tab that the maps app then abandons
 * — the `about:blank` bug, on the one device where it is hardest to notice.
 */
export function detectMapsPlatform(userAgent: string, maxTouchPoints = 0): MapsPlatform {
  if (/android/iu.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/iu.test(userAgent)) return 'ios';
  // A touch-capable "Mac" is an iPad. A real Mac reports 0.
  if (/macintosh/iu.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return 'desktop';
}

/** The Android package that owns each app; `undefined` = no Android app to hand off to. */
const ANDROID_PACKAGE: Partial<Record<MapsApp, string>> = {
  google: 'com.google.android.apps.maps',
  waze: 'com.waze',
};

/**
 * Where to send the driver, and HOW.
 *
 * `target` is not cosmetic — it is the difference between the app opening and a stray tab:
 * - `self` — a hand-off. Either an Android intent (the OS launches the app, or follows the fallback
 *   when it is not installed) or an iOS universal link (the OS claims it for the app). The page is
 *   not actually navigated when the app takes over, so the panel is exactly where it was on return.
 * - `blank` — a plain website, in a new tab, so the admin keeps the order they were reading.
 */
export interface MapsLink {
  url: string;
  target: 'self' | 'blank';
}

/**
 * An Android `intent://` URL for a maps app.
 *
 * The shape is `intent://<host+path+query>#Intent;scheme=https;package=…;S.browser_fallback_url=…;end`
 * — the `intent://` prefix REPLACES the scheme, which the fragment then restores. The fallback is
 * percent-encoded because it carries `:`, `/`, `?` and `&`, any of which would otherwise terminate
 * the intent's own `;`-separated parameter list.
 */
function androidIntent(httpsUrl: string, androidPackage: string): string {
  const withoutScheme = httpsUrl.replace(/^https:\/\//u, '');
  const fallback = encodeURIComponent(httpsUrl);
  return `intent://${withoutScheme}#Intent;scheme=https;package=${androidPackage};S.browser_fallback_url=${fallback};end`;
}

/** {@link MapsLink} for one app, destination and platform — the single decision this module exists
 *  to make. Pure, so the whole matrix is testable without a device. */
export function buildMapsLink(
  app: MapsApp,
  destination: MapsDestination,
  platform: MapsPlatform,
): MapsLink {
  const url = buildMapsUrl(app, destination);
  if (platform === 'android') {
    const androidPackage = ANDROID_PACKAGE[app];
    // Apple Maps has no Android app, so there is nothing to hand off to — its website in a new tab
    // is the honest answer rather than an intent that can only ever take the fallback.
    return androidPackage ? { url: androidIntent(url, androidPackage), target: 'self' } : { url, target: 'blank' };
  }
  // iOS resolves a universal link at navigation time; a desktop has no app and keeps its new tab.
  return { url, target: platform === 'ios' ? 'self' : 'blank' };
}

/**
 * Follow a {@link MapsLink}.
 *
 * A hand-off is performed as a real ANCHOR ACTIVATION rather than a `location` assignment: that is
 * the navigation both `intent://` and iOS universal links are documented against, and the one the
 * browser is least likely to treat as a script-driven redirect. The new-tab path deliberately keeps
 * `window.open` — it is what already works on a desktop, and nothing here is a reason to change it.
 */
export function openMapsLink(link: MapsLink): void {
  if (link.target === 'blank') {
    // `noopener` is required with `_blank`: without it the opened tab gets a handle back here.
    window.open(link.url, '_blank', 'noopener,noreferrer');
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = link.url;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * The destination for an order's delivery — **only when that ORDER has a PIN** (owner decision,
 * 2026-08-04). `undefined` otherwise, which is the signal to render no navigation button at all.
 *
 * It used to fall back to searching the address TEXT, and that was worse than nothing: a walk-in
 * address like "Test dirección" or "Salón del club, entrada norte" is not a geocodable query, so the
 * button opened a maps app on a search that lands somewhere unrelated — or nowhere — while looking
 * exactly as trustworthy as a real pin. Offering navigation only when we can actually navigate makes
 * the button's presence itself the information.
 *
 * The pin read here is the ORDER's snapshot, never the client's current one: a saved address may
 * have been re-pinned or deleted since, and a past delivery must keep the coordinates it was
 * actually given. An order pinned directly (with the client's address left unpinned) therefore still
 * gets the button — which is exactly the intent.
 *
 * `address` remains the human LABEL carried alongside the pin, so the maps app shows a name rather
 * than a bare coordinate.
 */
export function orderDestination(
  address: string | undefined,
  coords: Coords | undefined,
): MapsDestination | undefined {
  if (!coords) {
    return undefined;
  }
  return { kind: 'coords', coords, ...(address !== undefined && { label: address }) };
}
