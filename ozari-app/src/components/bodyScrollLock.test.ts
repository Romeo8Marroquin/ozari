import { afterEach, describe, expect, it } from 'vitest';
import { lockBodyScroll } from './bodyScrollLock';

afterEach(() => {
  document.body.style.overflow = '';
});

describe('lockBodyScroll', () => {
  it('locks on the first hold and restores only on the last release', () => {
    // The ordering bug this replaces: two dialogs each saving/restoring `overflow` themselves left
    // the page unscrollable, because the outer one restored '' and the inner then restored 'hidden'.
    const releaseOuter = lockBodyScroll();
    const releaseInner = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');

    // Released in the SAME order React tears down (outer first) — the page must stay locked.
    releaseOuter();
    expect(document.body.style.overflow).toBe('hidden');

    releaseInner();
    expect(document.body.style.overflow).toBe('');
  });

  it('restores whatever was there before, not a hardcoded empty string', () => {
    document.body.style.overflow = 'scroll';
    const release = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    release();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('ignores a release called twice', () => {
    // Otherwise one over-eager cleanup could drop the count below zero and unlock the page while
    // another dialog is still open.
    const releaseA = lockBodyScroll();
    const releaseB = lockBodyScroll();
    releaseA();
    releaseA();
    expect(document.body.style.overflow).toBe('hidden');
    releaseB();
    expect(document.body.style.overflow).toBe('');
  });
});
