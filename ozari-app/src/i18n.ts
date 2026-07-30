import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import es from './assets/locales/es.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'es',
    supportedLngs: ['es', 'en'],
    interpolation: { escapeValue: false },
    /**
     * A placeholder the caller forgot to pass renders as a LITERAL `{{client}}` in the UI — silent,
     * in production, in front of the user.
     *
     * The suite is what actually PREVENTS it (`src/test/i18nContract.ts` fails any `t()` call
     * missing a value, and 100% coverage means every call site runs); this is the same check during
     * the dev loop, before a test exists. DEV-only on purpose: shipping it would turn a cosmetic
     * gap into console noise for a user who can't act on it, and the string still renders either way.
     */
    missingInterpolationHandler: (text: string, value: unknown): undefined => {
      if (import.meta.env.DEV) {
        const name = Array.isArray(value) ? String(value[1] ?? value[0]) : String(value);
        console.error(`[i18n] Missing interpolation value ${name} for: "${text}"`);
      }
      return undefined;
    },
    resources: {
      es: { translation: es },
    },
  });

export default i18n;
