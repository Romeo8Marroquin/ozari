import { beforeAll, describe, expect, it } from "vitest";
import { initializeI18n } from "@/config/i18n.js";
import {
  buildMfaDisabledEmail,
  buildMfaEnabledEmail,
  buildPasswordChangedEmail,
} from "./securityEmail.js";

// Real i18n so the rendered copy + name interpolation/escaping are exercised for real.
beforeAll(async () => {
  await initializeI18n();
});

describe("security notification emails", () => {
  it("builds the password-changed email from the security sender, linking to sign in", () => {
    const message = buildPasswordChangedEmail({ to: "ana@example.com", name: "Ana" });

    expect(message.to).toBe("ana@example.com");
    expect(message.from).toBe("Party Rentals <seguridad@partyrentalsgt.com>");
    expect(message.subject).toBe("Tu contraseña de Party Rentals se actualizó");
    expect(message.html).toContain("<!doctype html>");
    expect(message.html).toContain("Tu contraseña se actualizó");
    expect(message.html).toContain("Ana");
    // The CTA sends the user to review their account (the login page).
    expect(message.html).toMatch(/href="https?:\/\/[^"]+\/sesion\/inicio"/);
    expect(message.text).toMatch(/https?:\/\/\S+\/sesion\/inicio/);
  });

  it("builds the MFA-enabled email", () => {
    const message = buildMfaEnabledEmail({ to: "x@y.com", name: "Ana" });

    expect(message.from).toBe("Party Rentals <seguridad@partyrentalsgt.com>");
    expect(message.subject).toBe("Activaste la verificación en dos pasos");
    expect(message.html).toContain("Verificación en dos pasos activada");
  });

  it("builds the MFA-disabled email", () => {
    const message = buildMfaDisabledEmail({ to: "x@y.com", name: "Ana" });

    expect(message.from).toBe("Party Rentals <seguridad@partyrentalsgt.com>");
    expect(message.subject).toBe("Desactivaste la verificación en dos pasos");
    expect(message.html).toContain("Verificación en dos pasos desactivada");
  });

  it("HTML-escapes the name in the HTML part but keeps the text part raw", () => {
    const message = buildPasswordChangedEmail({ to: "x@y.com", name: "O'Brien" });

    expect(message.html).toContain("O&#39;Brien");
    expect(message.html).not.toContain("O'Brien");
    expect(message.text).toContain("O'Brien");
  });
});
