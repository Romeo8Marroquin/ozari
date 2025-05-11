import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  default: {
    t: vi.fn((key) => key),
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
    changeLanguage: vi.fn(),
    language: 'es',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn().mockReturnValue({
    t: vi.fn((key) => key),
    i18n: {
      changeLanguage: vi.fn(),
      language: 'es',
    },
  }),
  initReactI18next: {
    type: 'backend',
  },
}));

vi.mock('i18next-browser-languagedetector', () => ({
  default: vi.fn(),
}));

describe('setup', () => {
  it('carga correctamente', () => {
    expect(true).toBe(true);
  });
});
