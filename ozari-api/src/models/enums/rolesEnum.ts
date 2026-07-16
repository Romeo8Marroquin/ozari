/**
 * The seeded `user_roles` ids. Role 3 is the DRIVER ("Repartidor") — the Epic-2A correction
 * (2026-07-16): employees are exclusively drivers for now (they deliver/pick up assigned orders and
 * manage their own profile; they must NOT see products or create orders). Future employee types
 * (cleaners, office) become NEW rows — permissions stay array-based, never widen this one.
 */
export enum RolesEnum {
  Client = 1,
  Admin,
  Driver,
}
