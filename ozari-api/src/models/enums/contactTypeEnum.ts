/**
 * Seeded `contact_types` rows (see `prisma/seed.ts` — ids are fixed by the seed). The channel of a
 * client-registry contact drives how its value is validated: EMAIL must look like an email,
 * WHATSAPP/TELEFONO like a phone number, OTRO is length-only. Mirrors the frontend
 * `contactChannelKind` (constants/Regex.ts).
 */
export enum ContactTypeEnum {
  WHATSAPP = 1,
  TELEFONO,
  CORREO,
  OTRO,
}
