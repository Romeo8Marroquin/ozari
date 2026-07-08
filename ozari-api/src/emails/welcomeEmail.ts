import { appConfig } from "@/config/app.js";
import { getAppHost } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import type { MailMessage } from "@helpers/mailer.js";
import { renderBrandedEmail } from "./layout.js";

const KEY = "email.welcome";
// Where the CTA points; the frontend origin, with a brand fallback if APP_HOST isn't set.
const FALLBACK_URL = "https://www.partyrentalsgt.com";
// The account is usable immediately (clients are active on creation — no admin gate), so the CTA
// takes the user straight to the login page to sign in.
const LOGIN_PATH = "/sesion/inicio";

/**
 * Builds the post-registration welcome email (branded HTML + a plain-text alternative). The
 * recipient's name is interpolated **escaped** into the HTML greeting (i18next's default) so a name
 * can never inject markup — belt-and-suspenders atop the `fullName` validator, which already forbids
 * `<>&"`. The plain-text greeting is rendered unescaped so an apostrophe (allowed in names) reads as
 * `'`, not `&#x27;`.
 */
export function buildWelcomeEmail(params: { to: string; name: string }): MailMessage {
  const { to, name } = params;

  const subject = i18next.t(`${KEY}.subject`);
  const heading = i18next.t(`${KEY}.heading`);
  const preview = i18next.t(`${KEY}.preview`);
  const body = i18next.t(`${KEY}.body`);
  const signature = i18next.t(`${KEY}.signature`);
  const footer = i18next.t(`${KEY}.footerNote`);
  const ctaLabel = i18next.t(`${KEY}.cta`);
  const ctaHref = `${getAppHost() || FALLBACK_URL}${LOGIN_PATH}`;

  const greetingHtml = i18next.t(`${KEY}.greeting`, { name });
  const greetingText = i18next.t(`${KEY}.greeting`, {
    name,
    interpolation: { escapeValue: false },
  });

  const html = renderBrandedEmail({
    preview,
    heading,
    bodyHtml: [
      `<p style="margin:0 0 16px;">${greetingHtml}</p>`,
      `<p style="margin:0 0 16px;">${body}</p>`,
      `<p style="margin:0;">${signature}</p>`,
    ].join(""),
    cta: { label: ctaLabel, href: ctaHref },
    footer,
  });

  const text = `${greetingText}\n\n${body}\n\n${ctaLabel}: ${ctaHref}\n\n${signature}\n\n${footer}`;

  return { to, from: appConfig.email.from.welcome, subject, text, html };
}
