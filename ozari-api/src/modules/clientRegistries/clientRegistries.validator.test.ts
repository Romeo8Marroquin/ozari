import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { validateCreateClientRegistry } from "./clientRegistries.validator.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

function mockPrisma(overrides: Record<string, unknown> = {}) {
  (getPrismaClient as Mock).mockResolvedValue({
    // 1=WhatsApp 2=Teléfono 3=Correo 4=Otro (the seeded contact-type ids).
    contactType: { findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]) },
    zone: { findMany: vi.fn().mockResolvedValue([{ id: 6 }]) },
    paymentMethod: { findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) },
    ...overrides,
  });
}

const validBody = () => ({
  name: "María López",
  contacts: [
    { contactTypeId: 1, value: "5555-1234" }, // WhatsApp → phone-shaped
    { contactTypeId: 3, value: "maria@example.com" }, // Correo → email-shaped
  ],
  addresses: [{ zoneId: 6, address: "Zona 10, 4a avenida 5-55" }],
});

const run = async (body: Record<string, unknown>) => {
  const req = { body } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  await validateCreateClientRegistry(req, {} as Response, next);
  return { req, next };
};

const expectRejected = (key: string) => {
  expect(sendOzariError).toHaveBeenCalledWith(
    expect.anything(),
    HttpEnum.BAD_REQUEST,
    `clientRegistries.createRegistry.validators.${key}`,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma();
});

describe("validateCreateClientRegistry", () => {
  it("passes a valid registry through, defaulting the FIRST contact/address to principal/favorite", async () => {
    const { req, next } = await run(validBody());
    expect(next).toHaveBeenCalled();
    const body = req.body as {
      contacts: Array<{ isPrincipal: boolean }>;
      addresses: Array<{ isFavorite: boolean }>;
      notes: string | undefined;
    };
    expect(body.contacts[0]?.isPrincipal).toBe(true);
    expect(body.contacts[1]?.isPrincipal).toBe(false);
    expect(body.addresses[0]?.isFavorite).toBe(true);
    expect(body.notes).toBeUndefined();
  });

  it("keeps an explicit principal/favorite and truncates the domicile price to cents", async () => {
    const { req, next } = await run({
      ...validBody(),
      notes: "  cliente de siempre  ",
      contacts: [
        { contactTypeId: 1, value: "5555-1234" },
        { contactTypeId: 3, value: "maria@example.com", isPrincipal: true },
      ],
      addresses: [
        {
          address: "Casa en Hacienda Real, lote 5",
          instructions: "  Portón negro  ",
          // A pin as a dragged map hands it over: far more precision than anyone needs.
          coords: { lat: 14.634915123456, lng: -90.506882987654 },
          domicilePrice: 0.999,
          isFavorite: true,
        },
      ],
    });
    expect(next).toHaveBeenCalled();
    const body = req.body as {
      notes: string;
      contacts: Array<{ isPrincipal: boolean }>;
      addresses: Array<{
        isFavorite: boolean;
        domicilePrice?: number;
        zoneId?: number;
        instructions?: string;
        coords?: { lat: number; lng: number };
      }>;
    };
    expect(body.notes).toBe("cliente de siempre");
    expect(body.contacts[0]?.isPrincipal).toBe(false);
    expect(body.contacts[1]?.isPrincipal).toBe(true);
    expect(body.addresses[0]).toMatchObject({ isFavorite: true, domicilePrice: 0.99 });
    expect(body.addresses[0]?.instructions).toBe("Portón negro");
    expect(body.addresses[0]?.zoneId).toBeUndefined();
    // Rounded to ~11 cm at the door, so the float noise never reaches an encrypted snapshot.
    expect(body.addresses[0]?.coords).toEqual({ lat: 14.634915, lng: -90.506883 });
  });

  it.each([
    ["invalidName", { name: "x" }],
    ["invalidNotes", { notes: 42 }],
    ["invalidContacts", { contacts: [] }],
    ["invalidContactTypeId", { contacts: [{ contactTypeId: 99, value: "5555" }] }],
    ["invalidContactValue", { contacts: [{ contactTypeId: 1, value: "x" }] }],
    [
      "multiplePrincipalContacts",
      {
        contacts: [
          { contactTypeId: 1, value: "5555-1234", isPrincipal: true },
          { contactTypeId: 3, value: "maria@example.com", isPrincipal: true },
        ],
      },
    ],
    // Per-channel value shape (mirrors the frontend): email must be an email, WhatsApp/phone a phone.
    ["invalidContactEmail", { contacts: [{ contactTypeId: 3, value: "not-an-email" }] }],
    ["invalidContactPhone", { contacts: [{ contactTypeId: 1, value: "abcdefg" }] }], // non-digit chars
    ["invalidContactPhone", { contacts: [{ contactTypeId: 2, value: "123" }] }], // too few digits
    ["invalidContactPhone", { contacts: [{ contactTypeId: 2, value: "12345678901234567" }] }], // too many
    ["invalidAddresses", { addresses: 42 }],
    ["invalidZoneId", { addresses: [{ zoneId: 99, address: "Zona 10, 4a avenida" }] }],
    ["invalidAddress", { addresses: [{ address: "abc" }] }],
    ["invalidInstructions", { addresses: [{ address: "Zona 10, 4a avenida", instructions: 42 }] }],
    ["invalidDomicilePrice", { addresses: [{ address: "Zona 10, 4a avenida", domicilePrice: -1 }] }],
    // A malformed pin is REFUSED, never silently dropped: to the admin who just placed it, a
    // discarded coordinate is indistinguishable from the map being broken.
    ["invalidCoords", { addresses: [{ address: "Zona 10, 4a avenida", coords: { lat: 91, lng: 0 } }] }],
    [
      "invalidCoords",
      { addresses: [{ address: "Zona 10, 4a avenida", coords: "14.6,-90.5" }] },
    ],
    [
      "multipleFavoriteAddresses",
      {
        addresses: [
          { address: "Zona 10, 4a avenida", isFavorite: true },
          { address: "Zona 15, 2a calle 3-33", isFavorite: true },
        ],
      },
    ],
    ["invalidPreferredPaymentMethodId", { preferredPaymentMethodId: 99 }],
  ])("rejects %s", async (key, patch) => {
    const { next } = await run({ ...validBody(), ...patch });
    expect(next).not.toHaveBeenCalled();
    expectRejected(key);
  });

  it("allows a registry with NO addresses (a walk-in types one per order) and a preferred method", async () => {
    // `addresses` omitted entirely — the validator treats a missing array as empty.
    const { req, next } = await run({
      name: "María López",
      contacts: [{ contactTypeId: 1, value: "5555-1234" }],
      preferredPaymentMethodId: 1,
    });
    expect(next).toHaveBeenCalled();
    const body = req.body as {
      addresses: unknown[];
      preferredPaymentMethodId: number | undefined;
    };
    expect(body.addresses).toHaveLength(0);
    expect(body.preferredPaymentMethodId).toBe(1);
  });

  it("caps the contact and address counts", async () => {
    const contacts = Array.from({ length: 11 }, () => ({ contactTypeId: 1, value: "5555-1234" }));
    await run({ ...validBody(), contacts });
    expectRejected("tooManyContacts");

    vi.clearAllMocks();
    mockPrisma();
    const addresses = Array.from({ length: 11 }, () => ({ address: "Zona 10, 4a avenida" }));
    await run({ ...validBody(), addresses });
    expectRejected("tooManyAddresses");
  });

  it("responds 500 when a lookup blows up", async () => {
    mockPrisma({ contactType: { findMany: vi.fn().mockRejectedValue(new Error("db down")) } });
    await run(validBody());
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "clientRegistries.createRegistry.validators.validationError",
    );
  });
});
