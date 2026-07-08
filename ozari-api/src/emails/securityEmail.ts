import { appConfig } from "@/config/app.js";
import { getAppHost } from "@/config/environment.js";
import { i18next } from "@/config/i18n.js";
import type { MailMessage } from "@helpers/mailer.js";
import { renderBrandedEmail } from "./layout.js";

// Where the CTA points; the frontend origin, with a brand fallback if APP_HOST isn't set.
const FALLBACK_URL = "https://www.partyrentalsgt.com";
// Security notices send the user to sign in and review their account (the panel is behind auth).
const LOGIN_PATH = "/sesion/inicio";

/**
 * Builds a branded security-notification email (account-safety event) from a set of i18n keys under
 * `key`: `.subject/.preview/.heading/.greeting/.body/.security/.cta/.footerNote`. Structure mirrors
 * the welcome email — greeting, what-happened body, and a "wasn't you?" safety line — then a CTA to
 * sign in and review the account. The recipient's name is HTML-escaped into the HTML greeting
 * (i18next's default) and rendered raw into the plain-text part (so an apostrophe reads naturally).
 */
function buildSecurityEmail(
  key: string,
  params: { to: string; name: string },
): MailMessage {
  const { to, name } = params;

  const subject = i18next.t(`${key}.subject`);
  const heading = i18next.t(`${key}.heading`);
  const preview = i18next.t(`${key}.preview`);
  const body = i18next.t(`${key}.body`);
  const security = i18next.t(`${key}.security`);
  const footer = i18next.t(`${key}.footerNote`);
  const ctaLabel = i18next.t(`${key}.cta`);
  const ctaHref = `${getAppHost() || FALLBACK_URL}${LOGIN_PATH}`;

  const greetingHtml = i18next.t(`${key}.greeting`, { name });
  const greetingText = i18next.t(`${key}.greeting`, {
    name,
    interpolation: { escapeValue: false },
  });

  const html = renderBrandedEmail({
    preview,
    heading,
    bodyHtml: [
      `<p style="margin:0 0 16px;">${greetingHtml}</p>`,
      `<p style="margin:0 0 16px;">${body}</p>`,
      `<p style="margin:0;">${security}</p>`,
    ].join(""),
    cta: { label: ctaLabel, href: ctaHref },
    footer,
  });

  const text = `${greetingText}\n\n${body}\n\n${security}\n\n${ctaLabel}: ${ctaHref}\n\n${footer}`;

  return { to, from: appConfig.email.from.security, subject, text, html };
}

/** Sent after a successful password change (which also revokes the user's other-device sessions). */
export function buildPasswordChangedEmail(params: {
  to: string;
  name: string;
}): MailMessage {
  return buildSecurityEmail("email.passwordChanged", params);
}

/** Sent after two-factor authentication is enabled. */
export function buildMfaEnabledEmail(params: {
  to: string;
  name: string;
}): MailMessage {
  return buildSecurityEmail("email.mfaEnabled", params);
}

/** Sent after two-factor authentication is disabled. */
export function buildMfaDisabledEmail(params: {
  to: string;
  name: string;
}): MailMessage {
  return buildSecurityEmail("email.mfaDisabled", params);
}

/**
 * Sent when a password reset is REQUESTED — the one security email whose CTA is a tokenized action
 * link (`resetUrl`), not a link to sign in. The footer reassures that ignoring it leaves the account
 * unchanged (so a mistaken/spoofed request is harmless).
 */
export function buildPasswordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
}): MailMessage {
  const { to, name, resetUrl } = params;
  const key = "email.passwordReset";

  const subject = i18next.t(`${key}.subject`);
  const heading = i18next.t(`${key}.heading`);
  const preview = i18next.t(`${key}.preview`);
  const body = i18next.t(`${key}.body`);
  const security = i18next.t(`${key}.security`);
  const footer = i18next.t(`${key}.footerNote`);
  const ctaLabel = i18next.t(`${key}.cta`);

  const greetingHtml = i18next.t(`${key}.greeting`, { name });
  const greetingText = i18next.t(`${key}.greeting`, {
    name,
    interpolation: { escapeValue: false },
  });

  const html = renderBrandedEmail({
    preview,
    heading,
    bodyHtml: [
      `<p style="margin:0 0 16px;">${greetingHtml}</p>`,
      `<p style="margin:0 0 16px;">${body}</p>`,
      `<p style="margin:0;">${security}</p>`,
    ].join(""),
    cta: { label: ctaLabel, href: resetUrl },
    footer,
  });

  const text = `${greetingText}\n\n${body}\n\n${ctaLabel}: ${resetUrl}\n\n${security}\n\n${footer}`;

  return { to, from: appConfig.email.from.security, subject, text, html };
}
