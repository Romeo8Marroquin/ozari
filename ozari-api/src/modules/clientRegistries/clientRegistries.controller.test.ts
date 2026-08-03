import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import {
  createClientRegistry,
  getClientRegistries,
} from "./clientRegistries.controller.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { encryptKms } from "@helpers/encryption.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import {
  type ClientRegistryEnvelopeModel,
  type ClientRegistryListResponseModel,
} from "./clientRegistries.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));
vi.mock("@/config/auditLogger.js", () => ({
  AuditAction: { ADMIN_ACTION: "ADMIN_ACTION" },
  logAudit: vi.fn(),
}));
vi.mock("@/config/environment.js", () => ({ isDeployedEnvironment: vi.fn(() => false) }));

const VALID_ENCRYPTION_KEY =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] = VALID_ENCRYPTION_KEY;
});

/** A raw registry row as `richRegistryInclude` fetches it (encrypted PII): a priced zone + a
 *  preferred payment method (the "everything present" projection branch). */
const makeRawRegistry = () => ({
  id: 3,
  nameKms: encryptKms("María López"),
  notesKms: null,
  preferredPaymentMethodId: 1,
  isActive: true,
  updatedAt: null,
  createdAt: new Date("2026-07-16T12:00:00.000Z"),
  contacts: [
    {
      id: 1,
      valueKms: encryptKms("5555-1234"),
      isPrincipal: true,
      contactType: { id: 1, name: "WhatsApp" },
    },
  ],
  addresses: [
    {
      id: 1,
      addressKms: encryptKms("Zona 10, 4a avenida 5-55"),
      instructionsKms: encryptKms("Portón negro"),
      // A saved pin — encrypted exactly like the text it belongs to.
      coordsKms: encryptKms("14.634915,-90.506883"),
      domicilePrice: new Prisma.Decimal("50.00"),
      isFavorite: true,
      zone: { id: 6, name: "Zona 10", deliveryFee: new Prisma.Decimal("50.00") },
    },
  ],
  preferredPaymentMethod: { id: 1, name: "Efectivo" },
});

/** The other projection branches: an address with NO zone, a zone with NO fee, and NO preferred
 *  payment method (nullable everything). */
const makeRawRegistryNullables = () => ({
  ...makeRawRegistry(),
  notesKms: encryptKms("cliente de siempre"),
  preferredPaymentMethodId: null,
  addresses: [
    {
      id: 1,
      addressKms: encryptKms("Casa en Hacienda Real, lote 5"),
      instructionsKms: null,
      // No pin — the normal case, and the one the whole feature has to stay usable without.
      coordsKms: null,
      domicilePrice: null,
      isFavorite: true,
      zone: null,
    },
    {
      id: 2,
      addressKms: encryptKms("Zona 15, 2a calle 3-33"),
      instructionsKms: null,
      coordsKms: null,
      domicilePrice: null,
      isFavorite: false,
      zone: { id: 8, name: "Zona 15", deliveryFee: null },
    },
  ],
  preferredPaymentMethod: null,
});

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const findMany = vi.fn().mockResolvedValue([makeRawRegistry()]);
  const count = vi.fn().mockResolvedValue(1);
  const create = vi.fn().mockResolvedValue(makeRawRegistry());
  (getPrismaClient as Mock).mockResolvedValue({
    clientRegistry: { findMany, count, create },
    ...overrides,
  });
  return { findMany, count, create };
}

const buildReq = (
  query: Record<string, unknown> = {},
  body: Record<string, unknown> = {},
): CustomRequest =>
  ({ query, body, user: { userRole: 2, userId: 1 } }) as unknown as CustomRequest;

const successData = <T>(): T => (sendOzariSuccess as Mock).mock.calls[0]?.[3] as T;

beforeEach(() => vi.clearAllMocks());

describe("getClientRegistries", () => {
  it("returns the decrypted, projected page with pagination", async () => {
    const { findMany } = mockPrisma();
    await getClientRegistries(buildReq(), {} as Response);

    const data = successData<ClientRegistryListResponseModel>();
    expect(data.registries[0]).toMatchObject({
      id: 3,
      name: "María López",
      notes: undefined,
      contacts: [
        { id: 1, contactType: { id: 1, name: "WhatsApp" }, value: "5555-1234", isPrincipal: true },
      ],
      addresses: [
        {
          id: 1,
          zone: { id: 6, name: "Zona 10", deliveryFee: 50 },
          address: "Zona 10, 4a avenida 5-55",
          instructions: "Portón negro",
          domicilePrice: 50,
          isFavorite: true,
        },
      ],
      preferredPaymentMethod: { id: 1, name: "Efectivo" },
    });
    expect(data.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 0,
        take: 20,
      }),
    );
  });

  it("clamps pagination instead of rejecting it", async () => {
    const { findMany } = mockPrisma();
    await getClientRegistries(buildReq({ page: "abc", pageSize: "9999" }), {} as Response);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 100 }));
  });

  it("responds 500 when the query fails", async () => {
    mockPrisma({
      clientRegistry: { findMany: vi.fn().mockRejectedValue(new Error("db down")), count: vi.fn() },
    });
    await getClientRegistries(buildReq(), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "clientRegistries.getRegistries.errorFetchingRegistries",
    );
  });
});

describe("createClientRegistry", () => {
  const validatedBody = () => ({
    name: "María López",
    notes: "cliente de siempre",
    contacts: [{ contactTypeId: 1, value: "5555-1234", isPrincipal: true }],
    addresses: [
      {
        zoneId: 6,
        address: "Zona 10, 4a avenida 5-55",
        coords: { lat: 14.634915, lng: -90.506883 },
        isFavorite: true,
      },
      { address: "Casa en Hacienda Real, lote 5", isFavorite: false },
    ],
    preferredPaymentMethodId: 1,
  });

  it("encrypts every PII field into a nested create and answers with the projected registry", async () => {
    const { create } = mockPrisma();
    await createClientRegistry(buildReq({}, validatedBody()), {} as Response);

    const arg = (create as Mock).mock.calls[0]?.[0] as {
      data: {
        nameKms: string;
        notesKms: string;
        contacts: { create: Array<Record<string, unknown>> };
        addresses: { create: Array<Record<string, unknown>> };
      };
    };
    expect(arg.data.nameKms).not.toBe("María López");
    expect(arg.data.notesKms).not.toBe("cliente de siempre");
    expect(arg.data.contacts.create[0]).toMatchObject({ contactTypeId: 1, isPrincipal: true });
    expect(arg.data.contacts.create[0]?.["valueKms"]).not.toBe("5555-1234");
    // An address without a zone persists NULL (outside the seeded zones — e.g. Hacienda Real).
    expect(arg.data.addresses.create[0]).toMatchObject({ zoneId: 6, isFavorite: true });
    expect(arg.data.addresses.create[1]).toMatchObject({ zoneId: null, isFavorite: false });
    // The pin is PII: encrypted like the address text, never stored as readable coordinates — and
    // an address without one persists NULL rather than an empty string.
    expect(arg.data.addresses.create[0]?.["coordsKms"]).not.toBe("14.634915,-90.506883");
    expect(arg.data.addresses.create[0]?.["coordsKms"]).toEqual(expect.any(String));
    expect(arg.data.addresses.create[1]?.["coordsKms"]).toBeNull();
    // …and it survives the round trip: the projection decrypts and decodes it back to numbers.
    expect(successData<ClientRegistryEnvelopeModel>().registry.addresses[0]?.coords).toEqual({
      lat: 14.634915,
      lng: -90.506883,
    });
    expect((arg.data as { preferredPaymentMethodId: number }).preferredPaymentMethodId).toBe(1);

    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CREATED,
      "clientRegistries.createRegistry.registryCreated",
      expect.anything(),
    );
    expect(successData<ClientRegistryEnvelopeModel>().registry.name).toBe("María López");
  });

  it("defaults an absent preferred method to NULL and projects the nullable branches", async () => {
    const create = vi.fn().mockResolvedValue(makeRawRegistryNullables());
    mockPrisma({ clientRegistry: { create } });
    const { preferredPaymentMethodId: _drop, ...bodyWithoutPreferred } = validatedBody();
    await createClientRegistry(buildReq({}, bodyWithoutPreferred), {} as Response);

    const arg = (create as Mock).mock.calls[0]?.[0] as { data: { preferredPaymentMethodId: null } };
    expect(arg.data.preferredPaymentMethodId).toBeNull();

    const registry = successData<ClientRegistryEnvelopeModel>().registry;
    expect(registry.notes).toBe("cliente de siempre");
    expect(registry.preferredPaymentMethod).toBeUndefined();
    // address[0]: no zone; address[1]: a zone without a configured fee.
    expect(registry.addresses[0]?.zone).toBeUndefined();
    expect(registry.addresses[1]?.zone).toEqual({ id: 8, name: "Zona 15" });
  });

  it("responds 500 when the create fails", async () => {
    mockPrisma({
      clientRegistry: { create: vi.fn().mockRejectedValue(new Error("db down")) },
    });
    await createClientRegistry(buildReq({}, validatedBody()), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "clientRegistries.createRegistry.errorCreatingRegistry",
    );
  });
});
