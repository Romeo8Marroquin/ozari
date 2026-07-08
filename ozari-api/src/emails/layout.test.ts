import { describe, expect, it } from "vitest";
import { renderBrandedEmail } from "./layout.js";

describe("renderBrandedEmail", () => {
  it("renders the branded shell with a CTA button, a logo, and dark-mode support", () => {
    const html = renderBrandedEmail({
      preview: "Preview line",
      heading: "Heading here",
      bodyHtml: "<p>Body paragraph</p>",
      cta: { label: "Continue", href: "https://example.com/go" },
      footer: "Footer note",
      logoUrl: "https://cdn.example.com/logo.png",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Party Rentals"); // brand (logo alt text)
    expect(html).toContain("Heading here");
    expect(html).toContain("<p>Body paragraph</p>");
    expect(html).toContain("Preview line"); // preheader
    // The CTA renders as a link to the href.
    expect(html).toContain('href="https://example.com/go"');
    expect(html).toContain("Continue");
    // A provided logo URL renders an <img> in the header.
    expect(html).toContain('<img src="https://cdn.example.com/logo.png"');
    // Forced light (no dark variant) + the app's radial auth background + a button hover.
    expect(html).toContain('content="light"');
    expect(html).toContain("radial-gradient(120% 120% at 50% 0%");
    expect(html).not.toContain("prefers-color-scheme");
    expect(html).toContain(".btn:hover");
  });

  it("omits the button, and omits the logo for an explicitly empty logo URL", () => {
    const html = renderBrandedEmail({
      preview: "Preview",
      heading: "Heading",
      bodyHtml: "<p>Body</p>",
      footer: "Footer",
      logoUrl: "", // an explicit empty string opts out of the header image (no config fallback)
    });

    // With no CTA there is no anchor/link in the document.
    expect(html).not.toContain("<a ");
    // An empty logo URL renders no header image.
    expect(html).not.toContain("<img");
    expect(html).toContain("<p>Body</p>");
  });
});
