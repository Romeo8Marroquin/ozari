/**
 * The application roles, mirroring the backend `RolesEnum` (the seeded `user_roles` ids). The access
 * token carries the current user's role as this number (`userRole`), so the client can label the UI
 * instantly from the decoded token — while the backend stays the real security boundary (it re-checks
 * the role against the DB on every request; see `verifyJwt` + `isGrantedRoles`).
 *
 * Role 3 is the DRIVER ("Repartidor") — the Epic-2A correction: employees are exclusively drivers
 * for now (deliveries/pickups of assigned orders + their own settings; no products, no orders on
 * behalf of clients). Future employee types become new ids — role checks stay array-based.
 */
export enum Role {
  Client = 1,
  Admin = 2,
  Driver = 3,
}
