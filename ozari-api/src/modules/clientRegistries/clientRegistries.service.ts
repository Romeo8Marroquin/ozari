import { Prisma } from "@prisma/client";
import { decryptKms } from "@helpers/encryption.js";
import { type ClientRegistryResponseModel } from "./clientRegistries.models.js";

/**
 * The Prisma `include` for the FULL registry shape (list + create response alike): contacts and
 * addresses with their lookup names, in id order (creation order — the admin's own sequence).
 * Attribute rows are hard-deleted (no-trash), so every row that exists is live.
 */
export const richRegistryInclude = {
  contacts: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      valueKms: true,
      isPrincipal: true,
      contactType: { select: { id: true, name: true } },
    },
  },
  addresses: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      addressKms: true,
      instructionsKms: true,
      domicilePrice: true,
      isFavorite: true,
      // `deliveryFee` = the zone's DEFAULT fee the order form suggests (a per-address
      // `domicilePrice` overrides it).
      zone: { select: { id: true, name: true, deliveryFee: true } },
    },
  },
  preferredPaymentMethod: { select: { id: true, name: true } },
} satisfies Prisma.ClientRegistryInclude;

/** A registry row fetched with `richRegistryInclude` — the projection's input. */
export type RichClientRegistry = Prisma.ClientRegistryGetPayload<{
  include: typeof richRegistryInclude;
}>;

/**
 * Projects a registry row for the admin (the only consumer — registries ARE an admin tool):
 * everything decrypted. Grows role tiers only if a future role ever reads registries.
 */
export function projectClientRegistry(
  registry: RichClientRegistry,
): ClientRegistryResponseModel {
  return {
    id: registry.id,
    name: decryptKms(registry.nameKms),
    notes: registry.notesKms !== null ? decryptKms(registry.notesKms) : undefined,
    contacts: registry.contacts.map((contact) => ({
      id: contact.id,
      contactType: contact.contactType,
      value: decryptKms(contact.valueKms),
      isPrincipal: contact.isPrincipal,
    })),
    addresses: registry.addresses.map((address) => ({
      id: address.id,
      zone:
        address.zone !== null
          ? {
              id: address.zone.id,
              name: address.zone.name,
              ...(address.zone.deliveryFee !== null && {
                deliveryFee: Number(address.zone.deliveryFee),
              }),
            }
          : undefined,
      address: decryptKms(address.addressKms),
      instructions:
        address.instructionsKms !== null ? decryptKms(address.instructionsKms) : undefined,
      domicilePrice: address.domicilePrice !== null ? Number(address.domicilePrice) : undefined,
      isFavorite: address.isFavorite,
    })),
    preferredPaymentMethod: registry.preferredPaymentMethod ?? undefined,
    createdAt: registry.createdAt,
  };
}
