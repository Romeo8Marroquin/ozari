import { beforeAll, describe, expect, it } from "vitest";
import { initializeI18n } from "@/config/i18n.js";
import { buildWelcomeEmail } from "./welcomeEmail.js";

// Real i18n so the rendered copy + name interpolation/escaping are exercised for real.
beforeAll(async () => {
  await initializeI18n();
});

describe("buildWelcomeEmail", () => {
  it("builds a branded welcome email addressed to the recipient", () => {
    const message = buildWelcomeEmail({ to: "ana@example.com", name: "Ana" });

    expect(message.to).toBe("ana@example.com");
    // The welcome email uses its own per-purpose sender.
    expect(message.from).toBe("Party Rentals <bienvenida@partyrentalsgt.com>");
    expect(message.subject).toBe("Te damos la bienvenida a Party Rentals");
    // Branded HTML shell + brand + the recipient's name.
    expect(message.html).toContain("<!doctype html>");
    expect(message.html).toContain("Party Rentals");
    expect(message.html).toContain("Ana");
    // A plain-text alternative is always present.
    expect(message.text).toContain("Ana");
    expect(message.text.length).toBeGreaterThan(0);
  });

  it("HTML-escapes the name in the HTML part but keeps the text part raw", () => {
    const message = buildWelcomeEmail({ to: "x@y.com", name: "O'Brien" });

    // HTML: the apostrophe is escaped, so the raw form never appears.
    expect(message.html).toContain("O&#39;Brien");
    expect(message.html).not.toContain("O'Brien");
    // Plain text: rendered raw so it reads naturally.
    expect(message.text).toContain("O'Brien");
  });

  it("includes a CTA link to the login page (APP_HOST or the brand fallback)", () => {
    const message = buildWelcomeEmail({ to: "x@y.com", name: "Ana" });

    // The account is usable immediately, so the CTA sends the user to sign in.
    expect(message.html).toContain("Iniciar sesión");
    expect(message.html).toMatch(/href="https?:\/\/[^"]+\/sesion\/inicio"/);
    expect(message.text).toMatch(/https?:\/\/\S+\/sesion\/inicio/);
  });
});
