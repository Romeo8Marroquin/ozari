import '@testing-library/jest-dom';
import { vi } from 'vitest';

/**
 * Global test setup (Vitest `setupFiles`). Unit tests don't exercise real translations, so `t`
 * returns the key it was given — assertions can then check *which* key a code path chose. The i18n
 * singletons are also heavy/async, so mocking them keeps unit tests synchronous and hermetic.
 */
const t = (key: string): string => key;

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
// components skip their GSAP timelines and render in their final, visible, accessible state — tests
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
