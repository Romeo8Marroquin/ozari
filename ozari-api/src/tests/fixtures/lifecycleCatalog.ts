import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  InventoryHoldEnum,
  StatusAppliesToEnum,
  TrackedEventEnum,
} from "@models/enums/serviceLifecycleEnum.js";
import type {
  ActorContextModel,
  EvidenceBoundsModel,
  StatusDefinitionModel,
} from "@modules/orders/lifecycle/lifecycle.models.js";
import type { OrderProjectionContextModel } from "@modules/orders/orders.service.js";

/**
 * TEST FIXTURE (not shipped logic — `src/tests/**` is coverage-excluded): the lifecycle catalog
 * exactly as `prisma/seed.ts` writes it, so every suite reasons about the SAME machine the business
 * actually runs:
 *
 *   Pendiente(1) → En ruta(2) → Entregado(3) → Recolectado(4) → Listo(5)   + Cancelado (off-ramp)
 *
 * Recolectado/Listo are RENTAL-only, which is what makes a purchase-only order finish at Entregado.
 */
const definition = (
  overrides: Partial<StatusDefinitionModel> &
    Pick<StatusDefinitionModel, "id" | "name">,
): StatusDefinitionModel => ({
  description: null,
  isActive: true,
  sortOrder: null,
  isInitial: false,
  isDisruptive: false,
  inventoryHold: InventoryHoldEnum.NONE,
  requiresEvidence: false,
  minEvidence: null,
  maxEvidence: null,
  appliesTo: StatusAppliesToEnum.ALL,
  tracksEvent: null,
  colorKey: null,
  ...overrides,
});

export const SEEDED_STATUS_CATALOG: StatusDefinitionModel[] = [
  definition({
    id: 1,
    name: "Pendiente",
    sortOrder: 1,
    isInitial: true,
    inventoryHold: InventoryHoldEnum.WINDOW,
    colorKey: "amber",
  }),
  definition({
    id: 2,
    name: "Cancelado",
    isDisruptive: true,
    colorKey: "red",
  }),
  definition({
    id: 3,
    name: "Entregado",
    sortOrder: 3,
    inventoryHold: InventoryHoldEnum.OUT,
    requiresEvidence: true,
    tracksEvent: TrackedEventEnum.DELIVERY,
    colorKey: "emerald",
  }),
  definition({
    id: 4,
    name: "Recolectado",
    sortOrder: 4,
    inventoryHold: InventoryHoldEnum.OUT,
    requiresEvidence: true,
    tracksEvent: TrackedEventEnum.COLLECTION,
    appliesTo: StatusAppliesToEnum.RENTAL,
    colorKey: "sky",
  }),
  definition({
    id: 5,
    name: "En ruta",
    sortOrder: 2,
    inventoryHold: InventoryHoldEnum.OUT,
    colorKey: "indigo",
  }),
  definition({
    id: 6,
    name: "Listo",
    sortOrder: 5,
    appliesTo: StatusAppliesToEnum.RENTAL,
    colorKey: "violet",
  }),
];

/** The status ids the seeded machine holds units in — `{ out: [En ruta, Entregado, Recolectado],
 *  window: [Pendiente] }`, the shape the availability queries take. */
export const SEEDED_HOLDING_IDS = { out: [3, 4, 5], window: [1] };

export const DEFAULT_EVIDENCE_BOUNDS: EvidenceBoundsModel = { min: 1, max: 10 };

/** A projection context over the seeded machine; defaults to an Admin (userId 1). */
export const makeProjectionContext = (
  actor: Partial<ActorContextModel> = {},
  catalog: StatusDefinitionModel[] = SEEDED_STATUS_CATALOG,
): OrderProjectionContextModel => ({
  catalog,
  actor: { userId: 1, role: RolesEnum.Admin, ...actor },
  evidence: DEFAULT_EVIDENCE_BOUNDS,
});
