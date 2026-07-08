/**
 * Branded HTML email shell, mirroring the app's visual language: the auth screens' soft radial
 * background (top-centred faint-lavender), a white "paper" card, the cream→blossom gradient header,
 * and the app's charcoal primary button (matching `components/Button`).
 *
 * Email HTML is NOT web HTML: clients (Outlook especially) strip external CSS and need table-based
 * layout with inline styles. So the structure is tables + inline styles, ~600px wide, web-safe fonts,
 * with a solid-colour fallback under every gradient (Outlook ignores gradients).
 *
 * **Always light.** We deliberately do NOT ship a dark variant — the card stays white in every client.
 * `color-scheme: light` (meta + CSS) tells clients that honour it (Apple Mail, iOS) not to auto-dark
 * the design. Gmail's mobile app force-inverts regardless and ignores that signal — it can't be fully
 * controlled, so we don't chase it; the light design is the single source of truth.
 *
 * The one `<style>` block is progressive enhancement that can't inline: the button `:hover` (a subtle
 * lift + shadow, mirroring the app button — works in webmail/Apple Mail, ignored where hover is moot).
 * There are still no animations; the design carries through colour, spacing and type, not motion.
 */

import { appConfig } from "@/config/app.js";

/** Brand palette, mirrored from the frontend `--color-*` tokens (src/index.css). */
const COLORS = {
  charcoal: "#262626", // body text
  cream: "#fceda7",
  blossom: "#fca7f0",
  paper: "#ffffff",
  pageSolid: "#efeaf0", // solid fallback under the radial page background
  muted: "#6f6f6f",
  hairline: "#ececec",
  button: "#1d1b1e", // matches components/Button's default color (near-black)
  buttonHover: "#141215", // its hover shade (color-mix(button 88%, #000))
} as const;

/** The auth screens' background (SesionLayout): a faint top-centred radial into light lavender. */
const PAGE_GRADIENT =
  "radial-gradient(120% 120% at 50% 0%, #faf7fa 0%, #efeaf0 58%, #e7e0e8 100%)";

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface BrandedEmailContent {
  /** Hidden inbox-preview (preheader) text. */
  preview: string;
  /** Heading rendered in the gradient header band. */
  heading: string;
  /** Body HTML — one or more `<p>` blocks already composed from (escaped) i18n strings. */
  bodyHtml: string;
  /** Optional call-to-action button. */
  cta?: { label: string; href: string };
  /** Small muted footer note under the divider. */
  footer: string;
  /**
   * Optional hosted logo image URL for the header (above the wordmark). Falls back to
   * `appConfig.email.logoUrl`; when both are empty the wordmark alone carries the brand.
   */
  logoUrl?: string;
}

/**
 * Wraps composed body HTML in the branded shell and returns a complete, self-contained HTML document
 * suitable for an email `html` part. All values are assumed already safe (i18n strings +
 * HTML-escaped interpolations); this function does no escaping of its own.
 */
export function renderBrandedEmail(content: BrandedEmailContent): string {
  const { preview, heading, bodyHtml, cta, footer } = content;
  const logoUrl = content.logoUrl ?? appConfig.email.logoUrl;

  // Progressive enhancement (see file header): the app button's lift-and-shadow hover. Mirrored via
  // the .btn class; !important beats the inline resting styles. Ignored where <style>/hover isn't
  // supported — the button still looks correct, just without the hover feedback.
  const styleBlock = `
    <style>
      :root { color-scheme: light; supported-color-schemes: light; }
      .btn { transition: transform 0.2s ease-out, box-shadow 0.2s ease-out, background-color 0.2s ease-out; }
      .btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 18px rgba(29,27,30,0.28) !important;
        background-color: ${COLORS.buttonHover} !important;
      }
    </style>`;

  const logo = logoUrl
    ? `<img src="${logoUrl}" width="56" height="71" alt="Party Rentals" style="display:block;margin:0 auto 18px;border:0;outline:none;text-decoration:none;">`
    : "";

  const button = cta
    ? `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px auto 4px;">
        <tr>
          <td align="center" bgcolor="${COLORS.button}" style="border-radius:14px;background-color:${COLORS.button};">
            <a class="btn" href="${cta.href}" target="_blank" style="display:inline-block;padding:15px 32px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px;background-color:${COLORS.button};box-shadow:0 1px 2px rgba(0,0,0,0.08);">${cta.label}</a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!doctype html>
<html lang="es" style="color-scheme:light;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${heading}</title>${styleBlock}
</head>
<body style="margin:0;padding:0;background-color:${COLORS.pageSolid};">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${preview}</span>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${COLORS.pageSolid}" style="background-color:${COLORS.pageSolid};background-image:${PAGE_GRADIENT};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" bgcolor="${COLORS.paper}" style="width:600px;max-width:100%;border-radius:16px;overflow:hidden;background-color:${COLORS.paper};box-shadow:0 8px 30px rgba(38,38,38,0.10);">
        <!-- Header band: cream→blossom gradient (solid cream fallback for Outlook). -->
        <tr>
          <td align="center" bgcolor="${COLORS.cream}" style="background-color:${COLORS.cream};background-image:linear-gradient(135deg,${COLORS.cream} 0%,${COLORS.blossom} 100%);padding:36px 32px;">
            ${logo}<div style="font-family:${FONT_STACK};font-size:24px;line-height:1.3;font-weight:700;color:${COLORS.charcoal};margin:0;">${heading}</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 36px 8px;font-family:${FONT_STACK};font-size:15px;line-height:1.65;color:${COLORS.charcoal};">
            ${bodyHtml}
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td align="center" style="padding:8px 36px 32px;">
            ${button}
          </td>
        </tr>
        <!-- Divider + footer -->
        <tr>
          <td style="padding:0 36px;">
            <div style="border-top:1px solid ${COLORS.hairline};"></div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px 28px;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${COLORS.muted};">
            ${footer}
          </td>
        </tr>
        <!-- Bottom accent band: the auth card's cream→blossom edge, evoked as a slim gradient bar. -->
        <tr>
          <td bgcolor="${COLORS.cream}" style="height:5px;line-height:5px;font-size:0;background-color:${COLORS.cream};background-image:linear-gradient(90deg,${COLORS.cream} 0%,${COLORS.blossom} 100%);">&nbsp;</td>
        </tr>
      </table>
      <div style="font-family:${FONT_STACK};font-size:11px;color:${COLORS.muted};padding:20px 0 0;">© Party Rentals</div>
    </td>
  </tr>
</table>
</body>
</html>`;
}
