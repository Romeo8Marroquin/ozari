import { beforeEach, describe, expect, it } from 'vitest';
import { StorageKeys } from '@constants/StorageKeys';
import { clearAuthState } from './tokenRefresh';
import { getMapsAppPreference, setMapsAppPreference } from './mapsPreference';

describe('mapsPreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to ASKING — never to an app that may not be installed', () => {
    expect(getMapsAppPreference()).toBe('ask');
  });

  it('remembers a real choice', () => {
    setMapsAppPreference('waze');
    expect(getMapsAppPreference()).toBe('waze');
  });

  it('stores "no preference" as an ABSENT key, not as a sentinel', () => {
    setMapsAppPreference('google');
    setMapsAppPreference('ask');
    expect(localStorage.getItem(StorageKeys.MAPS_APP)).toBeNull();
    expect(getMapsAppPreference()).toBe('ask');
  });

  it('degrades to asking when the stored value is unrecognisable', () => {
    // Hand-edited storage, or a value from a future version: opening the WRONG app silently would
    // be worse than offering the choice again.
    localStorage.setItem(StorageKeys.MAPS_APP, JSON.stringify('mapquest'));
    expect(getMapsAppPreference()).toBe('ask');
  });

  it('SURVIVES logout — it describes the device, not the account', () => {
    // A shared delivery phone must not re-ask every shift. This pins the state-taxonomy decision:
    // the maps app sits with the device uuid and the language, not with user-scoped drafts.
    setMapsAppPreference('waze');
    clearAuthState();
    expect(getMapsAppPreference()).toBe('waze');
  });
});
