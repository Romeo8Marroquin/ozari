import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { MAPS_APPS, type MapsApp, type MapsAppPreference } from './mapLinks';

/**
 * WHICH MAPS APP TO OPEN — a DEVICE preference, not an account setting.
 *
 * Two decisions are baked in here:
 *
 * 1. **Local, not server-side.** Whether Waze is installed is a fact about the phone in someone's
 *    hand, not about their user record. A driver switching to the spare phone should get that
 *    phone's answer, and setting it must never need a round trip or admin permission — which is
 *    also why it is available to EVERY role rather than living in the admin preferences screen.
 * 2. **It survives logout.** `clearAuthState` clears user-scoped state; this sits with the device
 *    uuid and the language on the globals side. A shared delivery phone that re-asked every shift
 *    would be a worse tool than one that just remembers.
 *
 * `ask` is the honest default: until the user has chosen, the button offers the options instead of
 * guessing an app that may not be installed and failing silently.
 */
const DEFAULT_PREFERENCE: MapsAppPreference = 'ask';

const isMapsApp = (value: unknown): value is MapsApp =>
  typeof value === 'string' && (MAPS_APPS as readonly string[]).includes(value);

/** Reads the stored choice, treating anything unrecognised as "not chosen yet" — a hand-edited or
 *  outdated value must degrade to asking, never to opening the wrong app. */
export function getMapsAppPreference(): MapsAppPreference {
  const stored = Storage.get<unknown>(StorageKeys.MAPS_APP);
  return isMapsApp(stored) ? stored : DEFAULT_PREFERENCE;
}

/** Persists the choice; `ask` REMOVES the key rather than storing a sentinel, so "no preference"
 *  has exactly one representation on disk. */
export function setMapsAppPreference(preference: MapsAppPreference): void {
  if (preference === 'ask') {
    Storage.remove(StorageKeys.MAPS_APP);
    return;
  }
  Storage.set(StorageKeys.MAPS_APP, preference);
}
