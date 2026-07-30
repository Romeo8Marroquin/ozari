import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { assertTranslationContract } from './i18nContract';

/**
 * Global test setup (Vitest `setupFiles`). Unit tests don't exercise real translations, so `t`
 * returns the key it was given — assertions can then check *which* key a code path chose. The i18n
 * singletons are also heavy/async, so mocking them keeps unit tests synchronous and hermetic.
 *
 * Returning the key does NOT mean the call goes unchecked: every `t()` is held to the real
 * string's contract first (the key exists; every placeholder has a value). See `i18nContract.ts`
 * for why that guarantee is complete rather than best-effort.
 */
const t = assertTranslationContract;

vi.mock('i18next', () => ({
  default: {
    t,
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
    changeLanguage: vi.fn(),
    language: 'es',
  },
  t,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { changeLanguage: vi.fn(), language: 'es' } }),
  initReactI18next: { type: 'backend' },
  Trans: ({ children }: { children?: unknown }) => children,
}));

vi.mock('i18next-browser-languagedetector', () => ({ default: vi.fn() }));

// jsdom doesn't implement matchMedia. We report `prefers-reduced-motion: reduce` as TRUE so animated
// components skip their GSAP timelines and render in their final, visible, accessible state � tests
// assert content/behaviour, not animation frames (GSAP's `autoAlpha:0` start-state would otherwise
// leave elements `visibility:hidden` and invisible to role queries).
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: query === '(prefers-reduced-motion: reduce)',
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// jsdom doesn't implement IntersectionObserver (the infinite-scroll sentinel would throw on
// mount). This inert stand-in keeps components mountable; tests that assert observation behaviour
// (the sentinel hook's own suite) stub `window.IntersectionObserver` with a controllable mock.
class InertIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
window.IntersectionObserver = InertIntersectionObserver;

// jsdom doesn't implement ResizeObserver either (the overlay scrollbar resyncs on it). Same deal:
// an inert stand-in keeps components mountable; suites that assert resize behaviour stub their own.
class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
window.ResizeObserver = InertResizeObserver;
