import i18next from "i18next";
import FilesystemBackend from "i18next-fs-backend";
import * as i18nmiddleware from "i18next-http-middleware";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const initializeI18n = async () => {
  await i18next
    .use(FilesystemBackend)
    .use(i18nmiddleware.LanguageDetector)
    .init({
      backend: {
        loadPath: path.join(
          __dirname,
          "..",
          "locales",
          "{{lng}}",
          "{{ns}}.json",
        ),
      },
      detection: {
        lookupHeader: "accept-language",
        order: ["header"],
      },
      fallbackLng: "es-GT",
      preload: ["es-GT"],
      supportedLngs: ["es-GT"],
      ns: ["translation"],
      defaultNS: "translation",
      initImmediate: false,
    });
};

export { i18next };
export { i18nmiddleware };
