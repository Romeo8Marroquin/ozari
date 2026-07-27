import { beforeEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "@/config/app.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  InventoryHoldEnum,
  StatusAppliesToEnum,
} from "@models/enums/serviceLifecycleEnum.js";
import { SEEDED_STATUS_CATALOG } from "@/tests/fixtures/lifecycleCatalog.js";
import type {
  ActorContextModel,
  LifecycleOrderModel,
  StatusDefinitionModel,
} from "./lifecycle.models.js";
import {
  applicablePipeline,
  canTransition,
  describeActions,
  disruptiveStates,
  evidenceBoundsFor,
  getEvidenceBounds,
  getStatusCatalog,
  holdingStatusIds,
  initialStatus,
  invalidateStatusCatalog,
  isComplete,
  nextStatus,
  parseIntPreference,
  pipeline,
  previousStatus,
  resolveTransitions,
  statusById,
  toStatusDefinition,
  transitionKindFor,
} from "./lifecycle.service.js";

const findMany = vi.fn();
const preferenceFindMany = vi.fn();
vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn(async () => ({
    serviceStatus: { findMany },
    appPreference: { findMany: preferenceFindMany },
  })),
}));

const CATALOG = SEEDED_STATUS_CATALOG;
const ADMIN: ActorContextModel = { userId: 1, role: RolesEnum.Admin };
const DRIVER: ActorContextModel = { userId: 7, role: RolesEnum.Driver };
const CLIENT: ActorContextModel = { userId: 9, role: RolesEnum.Client };

/** An order sitting in `serviceStatusId`; a rental assigned to the driver unless told otherwise. */
const order = (
  overrides: Partial<LifecycleOrderModel> = {},
): LifecycleOrderModel => ({
  serviceStatusId: 1,
  assignedUserId: 7,
  isRental: true,
  cancelledAt: null,
  ...overrides,
});

const statusOf = (id: number): StatusDefinitionModel =>
  CATALOG.find((status) => status.id === id) as StatusDefinitionModel;

beforeEach(() => {
  invalidateStatusCatalog();
  findMany.mockReset();
  preferenceFindMany.mockReset();
});

describe("getStatusCatalog", () => {
  const row = {
    id: 1,
    name: "Pendiente",
    description: null,
    isActive: true,
    sortOrder: 1,
    isInitial: true,
    isDisruptive: false,
    inventoryHold: "WINDOW",
    requiresEvidence: false,
    minEvidence: null,
    maxEvidence: null,
    appliesTo: "ALL",
    tracksEvent: null,
    colorKey: "amber",
  };

  it("reads the whole table ONCE and memoizes it", async () => {
    findMany.mockResolvedValue([row]);
    const first = await getStatusCatalog();
    const second = await getStatusCatalog();
    expect(first).toEqual(second);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(first[0]).toMatchObject({
      id: 1,
      inventoryHold: InventoryHoldEnum.WINDOW,
    });
  });

  it("re-reads after an admin write invalidates the cache", async () => {
    findMany.mockResolvedValue([row]);
    await getStatusCatalog();
    invalidateStatusCatalog();
    await getStatusCatalog();
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("degrades a hand-edited/unknown flag value to its safest meaning", () => {
    const mapped = toStatusDefinition({
      ...row,
      inventoryHold: "SOMETHING",
      appliesTo: "WEIRD",
      tracksEvent: "NOPE",
    });
    expect(mapped.inventoryHold).toBe(InventoryHoldEnum.NONE);
    expect(mapped.appliesTo).toBe(StatusAppliesToEnum.ALL);
    expect(mapped.tracksEvent).toBeNull();
  });
});

describe("catalog derivations", () => {
  it("orders the pipeline by sortOrder and leaves the off-ramps out", () => {
    expect(pipeline(CATALOG).map((status) => status.name)).toEqual([
      "Pendiente",
      "En ruta",
      "Entregado",
      "Recolectado",
      "Listo",
    ]);
    expect(disruptiveStates(CATALOG).map((status) => status.name)).toEqual([
      "Cancelado",
    ]);
  });

  it("a SALE order's pipeline drops the rental-only steps", () => {
    expect(applicablePipeline(CATALOG, "SALE").map((s) => s.name)).toEqual([
      "Pendiente",
      "En ruta",
      "Entregado",
    ]);
    expect(applicablePipeline(CATALOG, "RENTAL")).toHaveLength(5);
  });

  it("finds the initial status, and falls back to the first pipeline step without the flag", () => {
    expect(initialStatus(CATALOG)?.id).toBe(1);
    const unflagged = CATALOG.map((status) => ({ ...status, isInitial: false }));
    expect(initialStatus(unflagged)?.id).toBe(1);
    expect(initialStatus([])).toBeNull();
  });

  it("ignores inactive rows in the pipeline but NOT in the inventory holds", () => {
    const retired = CATALOG.map((status) =>
      status.id === 5 ? { ...status, isActive: false } : status,
    );
    expect(pipeline(retired).map((s) => s.id)).not.toContain(5);
    // Unpublishing a status must never free units an order is still sitting on.
    expect(holdingStatusIds(retired).out).toContain(5);
  });

  it("splits the holding ids by HOW they hold", () => {
    expect(holdingStatusIds(CATALOG)).toEqual({
      out: [3, 4, 5],
      window: [1],
    });
  });

  it("resolves a status by id, or undefined when it vanished", () => {
    expect(statusById(CATALOG, 3)?.name).toBe("Entregado");
    expect(statusById(CATALOG, 99)).toBeUndefined();
  });
});

describe("nextStatus / previousStatus / isComplete", () => {
  it("walks a RENTAL order to the end of the pipeline", () => {
    expect(nextStatus(CATALOG, order({ serviceStatusId: 1 }))?.name).toBe("En ruta");
    expect(nextStatus(CATALOG, order({ serviceStatusId: 5 }))?.name).toBe("Entregado");
    expect(nextStatus(CATALOG, order({ serviceStatusId: 3 }))?.name).toBe("Recolectado");
    expect(nextStatus(CATALOG, order({ serviceStatusId: 4 }))?.name).toBe("Listo");
    expect(nextStatus(CATALOG, order({ serviceStatusId: 6 }))).toBeNull();
  });

  it("a purchase-only order finishes at Entregado (the rental steps don't apply)", () => {
    const sale = order({ serviceStatusId: 3, isRental: false });
    expect(nextStatus(CATALOG, sale)).toBeNull();
    expect(isComplete(CATALOG, sale)).toBe(true);
    // …while the same step on a rental still has collection ahead of it.
    expect(isComplete(CATALOG, order({ serviceStatusId: 3 }))).toBe(false);
  });

  it("offers no move from a disruptive state, an unknown status, or a cancelled order", () => {
    expect(nextStatus(CATALOG, order({ serviceStatusId: 2 }))).toBeNull();
    expect(nextStatus(CATALOG, order({ serviceStatusId: 99 }))).toBeNull();
    expect(previousStatus(CATALOG, order({ serviceStatusId: 99 }))).toBeNull();
    const cancelled = order({ serviceStatusId: 1, cancelledAt: new Date() });
    expect(nextStatus(CATALOG, cancelled)).toBeNull();
    expect(previousStatus(CATALOG, cancelled)).toBeNull();
    expect(isComplete(CATALOG, cancelled)).toBe(false);
    expect(isComplete(CATALOG, order({ serviceStatusId: 2 }))).toBe(false);
    expect(isComplete(CATALOG, order({ serviceStatusId: 99 }))).toBe(false);
  });

  it("rewinds to the previous APPLICABLE step, and stops at the first one", () => {
    expect(previousStatus(CATALOG, order({ serviceStatusId: 1 }))).toBeNull();
    expect(previousStatus(CATALOG, order({ serviceStatusId: 5 }))?.name).toBe("Pendiente");
    expect(previousStatus(CATALOG, order({ serviceStatusId: 6 }))?.name).toBe("Recolectado");
    // A sale order rewinding from Entregado skips straight over the rental-only steps.
    expect(
      previousStatus(CATALOG, order({ serviceStatusId: 3, isRental: false }))?.name,
    ).toBe("En ruta");
  });

  it("the LAST rental step completes the order", () => {
    expect(isComplete(CATALOG, order({ serviceStatusId: 6 }))).toBe(true);
    expect(isComplete(CATALOG, order({ serviceStatusId: 4 }))).toBe(false);
  });
});

describe("resolveTransitions — the permission matrix", () => {
  it("an ADMIN may advance, rewind and cancel any order", () => {
    const set = resolveTransitions(CATALOG, order({ serviceStatusId: 5 }), ADMIN);
    expect(set.forward?.name).toBe("Entregado");
    expect(set.backward?.name).toBe("Pendiente");
    expect(set.disruptive.map((s) => s.name)).toEqual(["Cancelado"]);
  });

  it("an assigned DRIVER may advance and cancel, but never rewind", () => {
    const set = resolveTransitions(CATALOG, order({ serviceStatusId: 5 }), DRIVER);
    expect(set.forward?.name).toBe("Entregado");
    expect(set.backward).toBeNull();
    expect(set.disruptive.map((s) => s.name)).toEqual(["Cancelado"]);
  });

  it("a driver gets NOTHING on an order that isn't theirs", () => {
    const set = resolveTransitions(
      CATALOG,
      order({ serviceStatusId: 5, assignedUserId: 99 }),
      DRIVER,
    );
    expect(set).toEqual({ forward: null, backward: null, disruptive: [] });
  });

  it("a client (and any other role) gets nothing — self-service is a later flow", () => {
    expect(resolveTransitions(CATALOG, order(), CLIENT)).toEqual({
      forward: null,
      backward: null,
      disruptive: [],
    });
  });

  it("an order pointing at a status that no longer exists offers no pipeline move", () => {
    const set = resolveTransitions(CATALOG, order({ serviceStatusId: 99 }), ADMIN);
    expect(set.forward).toBeNull();
    expect(set.backward).toBeNull();
    // Cancelling it is still offered — an admin must be able to close a stranded order.
    expect(set.disruptive.map((s) => s.name)).toEqual(["Cancelado"]);
  });

  it("a finished order offers nothing: cancelled, or already in a disruptive state", () => {
    expect(
      resolveTransitions(CATALOG, order({ cancelledAt: new Date() }), ADMIN),
    ).toEqual({ forward: null, backward: null, disruptive: [] });
    expect(
      resolveTransitions(CATALOG, order({ serviceStatusId: 2 }), ADMIN),
    ).toEqual({ forward: null, backward: null, disruptive: [] });
  });

  it("the last step still offers cancel and a rewind, just no forward", () => {
    const set = resolveTransitions(CATALOG, order({ serviceStatusId: 6 }), ADMIN);
    expect(set.forward).toBeNull();
    expect(set.backward?.name).toBe("Recolectado");
    expect(set.disruptive).toHaveLength(1);
  });
});

describe("transitionKindFor / canTransition", () => {
  it("labels each allowed move by its kind", () => {
    const current = order({ serviceStatusId: 5 });
    expect(transitionKindFor(CATALOG, current, statusOf(3), ADMIN)).toBe("forward");
    expect(transitionKindFor(CATALOG, current, statusOf(1), ADMIN)).toBe("backward");
    expect(transitionKindFor(CATALOG, current, statusOf(2), ADMIN)).toBe("disruptive");
  });

  it("refuses a skip-ahead, a rewind by a driver, and anything for a stranger", () => {
    const current = order({ serviceStatusId: 1 });
    // Pendiente → Entregado would skip En ruta.
    expect(transitionKindFor(CATALOG, current, statusOf(3), ADMIN)).toBeNull();
    expect(
      transitionKindFor(CATALOG, order({ serviceStatusId: 5 }), statusOf(1), DRIVER),
    ).toBeNull();
    expect(transitionKindFor(CATALOG, current, statusOf(5), CLIENT)).toBeNull();
    expect(canTransition(CATALOG, current, statusOf(5), ADMIN)).toBe(true);
    expect(canTransition(CATALOG, current, statusOf(3), ADMIN)).toBe(false);
  });

  it("never moves an order INTO an unpublished status", () => {
    const retired = CATALOG.map((status) =>
      status.id === 5 ? { ...status, isActive: false } : status,
    );
    const target = retired.find((s) => s.id === 5) as StatusDefinitionModel;
    expect(
      transitionKindFor(retired, order({ serviceStatusId: 1 }), target, ADMIN),
    ).toBeNull();
  });
});

describe("evidence bounds", () => {
  it("parses a positive int preference and falls back otherwise", () => {
    expect(parseIntPreference("4", 1)).toBe(4);
    for (const value of [undefined, "0", "-2", "1.5", "abc", ""]) {
      expect(parseIntPreference(value, 3)).toBe(3);
    }
  });

  it("reads the global bounds, defaulting each missing preference", async () => {
    preferenceFindMany.mockResolvedValue([
      { key: "orders.evidenceMinPhotos", value: "2" },
      { key: "orders.evidenceMaxPhotos", value: "6" },
    ]);
    expect(await getEvidenceBounds()).toEqual({ min: 2, max: 6 });

    preferenceFindMany.mockResolvedValue([]);
    expect(await getEvidenceBounds()).toEqual({
      min: appConfig.defaultEvidenceMinPhotos,
      max: appConfig.defaultEvidenceMaxPhotos,
    });
  });

  it("an inverted global pair collapses to max = min instead of being unsatisfiable", async () => {
    preferenceFindMany.mockResolvedValue([
      { key: "orders.evidenceMinPhotos", value: "5" },
      { key: "orders.evidenceMaxPhotos", value: "2" },
    ]);
    expect(await getEvidenceBounds()).toEqual({ min: 5, max: 5 });
  });

  it("a status inherits the globals, overrides them, and is clamped INTO them", () => {
    const globals = { min: 1, max: 10 };
    expect(evidenceBoundsFor(statusOf(3), globals)).toEqual({ min: 1, max: 10 });
    expect(
      evidenceBoundsFor(
        { ...statusOf(3), minEvidence: 2, maxEvidence: 4 },
        globals,
      ),
    ).toEqual({ min: 2, max: 4 });
    // Stale per-status values can never demand more than the uploader allows.
    expect(
      evidenceBoundsFor(
        { ...statusOf(3), minEvidence: 50, maxEvidence: 99 },
        globals,
      ),
    ).toEqual({ min: 10, max: 10 });
    // …nor less than the global minimum.
    expect(
      evidenceBoundsFor({ ...statusOf(3), minEvidence: 0 }, { min: 2, max: 5 }),
    ).toEqual({ min: 2, max: 5 });
  });
});

describe("describeActions", () => {
  const globals = { min: 1, max: 10 };

  it("describes the admin's three moves, with evidence only on the forward one", () => {
    const actions = describeActions(
      CATALOG,
      order({ serviceStatusId: 5 }),
      ADMIN,
      globals,
    );
    expect(actions).toEqual([
      {
        kind: "forward",
        statusId: 3,
        statusName: "Entregado",
        colorKey: "emerald",
        requiresEvidence: true,
        minEvidence: 1,
        maxEvidence: 10,
        requiresReason: false,
      },
      {
        kind: "backward",
        statusId: 1,
        statusName: "Pendiente",
        colorKey: "amber",
        requiresEvidence: false,
        minEvidence: 1,
        maxEvidence: 10,
        requiresReason: false,
      },
      {
        kind: "disruptive",
        statusId: 2,
        statusName: "Cancelado",
        colorKey: "red",
        requiresEvidence: false,
        minEvidence: 1,
        maxEvidence: 10,
        requiresReason: true,
      },
    ]);
  });

  it("rewinding INTO an evidence step never demands photos", () => {
    // Recolectado → Entregado: the target requires evidence, but undoing must not ask for a camera.
    const actions = describeActions(
      CATALOG,
      order({ serviceStatusId: 4 }),
      ADMIN,
      globals,
    );
    expect(actions.find((action) => action.kind === "backward")).toMatchObject({
      statusName: "Entregado",
      requiresEvidence: false,
    });
  });

  it("gives a stranger nothing to do", () => {
    expect(describeActions(CATALOG, order(), CLIENT, globals)).toEqual([]);
  });
});
