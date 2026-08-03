import { describe, expect, it } from 'vitest';
import {
  formatCoords,
  isShortMapsLink,
  isValidCoords,
  parseCoordsInput,
  roundCoords,
} from './geo';

describe('isValidCoords', () => {
  it('accepts a real pair anywhere on the globe', () => {
    expect(isValidCoords({ lat: 14.634915, lng: -90.506883 })).toBe(true);
    expect(isValidCoords({ lat: -90, lng: 180 })).toBe(true);
  });

  it('rejects everything the API would also reject (the mirrored contract)', () => {
    expect(isValidCoords({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidCoords({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidCoords({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isValidCoords({ lat: '14.6', lng: '-90.5' })).toBe(false);
    expect(isValidCoords(null)).toBe(false);
    expect(isValidCoords('14.6,-90.5')).toBe(false);
  });
});

describe('roundCoords / formatCoords', () => {
  it('rounds to the SAME precision the API stores, so the map never shows a lie', () => {
    expect(roundCoords({ lat: 14.634915123, lng: -90.506882987 })).toEqual({
      lat: 14.634915,
      lng: -90.506883,
    });
  });

  it('formats to a fixed width so the field does not reflow as the pin moves', () => {
    expect(formatCoords({ lat: 14.6, lng: -90.5 })).toBe('14.600000, -90.500000');
  });
});

describe('parseCoordsInput', () => {
  it('reads a bare pair, however it was copied', () => {
    expect(parseCoordsInput('14.634915,-90.506883')).toEqual({ lat: 14.634915, lng: -90.506883 });
    expect(parseCoordsInput('  14.634915, -90.506883  ')).toEqual({ lat: 14.634915, lng: -90.506883 });
    expect(parseCoordsInput('14.634915 -90.506883')).toEqual({ lat: 14.634915, lng: -90.506883 });
  });

  it('reads a full Google Maps place URL, preferring the EXACT pin over the map centre', () => {
    // `@` is where the camera sits; `!3d!4d` is the place itself — they differ by a block or two.
    const url =
      'https://www.google.com/maps/place/Salón/@14.600000,-90.500000,17z/data=!3m1!4b1!4m6!3d14.634915!4d-90.506883';
    expect(parseCoordsInput(url)).toEqual({ lat: 14.634915, lng: -90.506883 });
  });

  it('reads the query forms of Google, Waze and Apple links', () => {
    expect(parseCoordsInput('https://www.google.com/maps/search/?api=1&query=14.634915,-90.506883')).toEqual(
      { lat: 14.634915, lng: -90.506883 },
    );
    expect(parseCoordsInput('https://waze.com/ul?ll=14.634915,-90.506883&navigate=yes')).toEqual({
      lat: 14.634915,
      lng: -90.506883,
    });
    expect(parseCoordsInput('https://maps.apple.com/?daddr=14.634915,-90.506883&dirflg=d')).toEqual({
      lat: 14.634915,
      lng: -90.506883,
    });
    // URL-encoded comma — what a share sheet often produces.
    expect(parseCoordsInput('https://maps.apple.com/?ll=14.634915%2C-90.506883')).toEqual({
      lat: 14.634915,
      lng: -90.506883,
    });
  });

  it('returns nothing for input that carries no usable pin', () => {
    expect(parseCoordsInput('')).toBeUndefined();
    expect(parseCoordsInput('   ')).toBeUndefined();
    expect(parseCoordsInput('cerca de la iglesia')).toBeUndefined();
    expect(parseCoordsInput('14.634915')).toBeUndefined();
    // On the globe or nothing: a transposed pair is worse than a rejection.
    expect(parseCoordsInput('914.6,-90.5')).toBeUndefined();
    expect(parseCoordsInput('https://www.google.com/maps/place/Salón')).toBeUndefined();
  });
});

describe('isShortMapsLink', () => {
  it('recognises the shortened links that carry no coordinates at all', () => {
    // These resolve only via a redirect, so the UI must say THAT rather than "couldn't read it".
    expect(isShortMapsLink('https://maps.app.goo.gl/abc123')).toBe(true);
    expect(isShortMapsLink('  https://goo.gl/maps/xyz  ')).toBe(true);
    expect(isShortMapsLink('https://www.google.com/maps/@14.6,-90.5,17z')).toBe(false);
    expect(isShortMapsLink('14.6,-90.5')).toBe(false);
  });
});
