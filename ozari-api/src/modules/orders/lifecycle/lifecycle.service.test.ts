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
  TransitionKindModel,
} from "./lifecycle.models.js";
import {
  applicablePipeline,
  canTransition,
  currentHoldings,
  describeActions,
  holdingsAfter,
  inventoryEffectOf,
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
  resolveStatusPath,
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
/** Any fixed moment — these derivations only ever ask whether a timestamp is SET. */
const NOW = new Date("2026-07-28T12:00:00.000Z");
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
  isSale: false,
  cancelledAt: null,
  deliveredAt: null,
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

  it("expires on its own, so a seed or another instance's edit can't be served stale forever", async () => {
    // The cache is invalidated explicitly by admin writes — but a `pnpm db:seed`, a hand-edited row
    // or an edit on a DIFFERENT Cloud Run instance cannot call back, and a process serving a machine
    // that no longer exists loses the whole lifecycle silently.
    const start = Date.UTC(2026, 6, 27, 12, 0, 0);
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    findMany.mockResolvedValue([row]);

    await getStatusCatalog();
    clock.mockReturnValue(start + appConfig.statusCatalogTtlSeconds * 1000 - 1);
    await getStatusCatalog();
    expect(findMany).toHaveBeenCalledTimes(1); // still inside the TTL

    clock.mockReturnValue(start + appConfig.statusCatalogTtlSeconds * 1000);
    await getStatusCatalog();
    expect(findMany).toHaveBeenCalledTimes(2); // expired → re-read
    clock.mockRestore();
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

describe("resolveStatusPath — the admin jump, as a real path", () => {
  it("returns the single move for an ordinary step (any actor)", () => {
    const current = order({ serviceStatusId: 1 });
    expect(
      resolveStatusPath(CATALOG, current, statusOf(5), DRIVER)?.map((s) => s.name),
    ).toEqual(["En ruta"]);
    expect(
      resolveStatusPath(CATALOG, current, statusOf(2), ADMIN)?.map((s) => s.name),
    ).toEqual(["Cancelado"]);
  });

  it("walks EVERY step between here and a distant target (admin)", () => {
    // Pendiente → Listo is four real transitions, not one leap: each will write its own history
    // row, stamp its own actual and demand its own evidence.
    expect(
      resolveStatusPath(CATALOG, order({ serviceStatusId: 1 }), statusOf(6), ADMIN)?.map(
        (s) => s.name,
      ),
    ).toEqual(["En ruta", "Entregado", "Recolectado", "Listo"]);

    // …and backwards, in reverse order, so each undone step is left in turn.
    expect(
      resolveStatusPath(CATALOG, order({ serviceStatusId: 6 }), statusOf(5), ADMIN)?.map(
        (s) => s.name,
      ),
    ).toEqual(["Recolectado", "Entregado", "En ruta"]);
  });

  it("never walks a purchase-only order onto a rental-only step", () => {
    const sale = order({ serviceStatusId: 1, isRental: false });
    expect(resolveStatusPath(CATALOG, sale, statusOf(6), ADMIN)).toBeNull();
    expect(resolveStatusPath(CATALOG, sale, statusOf(3), ADMIN)?.map((s) => s.name)).toEqual([
      "En ruta",
      "Entregado",
    ]);
  });

  it("only an ADMIN may jump — a driver keeps their single step", () => {
    const current = order({ serviceStatusId: 1 });
    expect(resolveStatusPath(CATALOG, current, statusOf(3), DRIVER)).toBeNull();
    expect(resolveStatusPath(CATALOG, current, statusOf(3), CLIENT)).toBeNull();
    // …and not onto someone else's order either.
    expect(
      resolveStatusPath(CATALOG, order({ assignedUserId: 99 }), statusOf(5), DRIVER),
    ).toBeNull();
  });

  it("REOPENS a cancelled order onto any applicable step (admin only)", () => {
    const cancelled = order({ serviceStatusId: 2, cancelledAt: new Date() });
    // Placed directly back on the chosen step — a cancelled order sits outside the pipeline, so
    // there is no walk to make.
    expect(
      resolveStatusPath(CATALOG, cancelled, statusOf(3), ADMIN)?.map((s) => s.name),
    ).toEqual(["Entregado"]);
    expect(resolveStatusPath(CATALOG, cancelled, statusOf(2), ADMIN)).toBeNull(); // already there
    expect(resolveStatusPath(CATALOG, cancelled, statusOf(5), DRIVER)).toBeNull();
    // A cancelled SALE order can't be reopened onto a rental-only step.
    expect(
      resolveStatusPath(
        CATALOG,
        order({ serviceStatusId: 2, cancelledAt: new Date(), isRental: false }),
        statusOf(4),
        ADMIN,
      ),
    ).toBeNull();
  });

  it("refuses an unpublished target, a no-op, and an unknown current status", () => {
    const retired = CATALOG.map((status) =>
      status.id === 5 ? { ...status, isActive: false } : status,
    );
    expect(
      resolveStatusPath(retired, order({ serviceStatusId: 1 }), retired[4] as StatusDefinitionModel, ADMIN),
    ).toBeNull();
    // Moving to the status it is already in resolves to nothing.
    expect(resolveStatusPath(CATALOG, order({ serviceStatusId: 3 }), statusOf(3), ADMIN)).toBeNull();
    expect(resolveStatusPath(CATALOG, order({ serviceStatusId: 99 }), statusOf(3), ADMIN)).toBeNull();
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

describe("inventory holdings and effects", () => {
  it("derives what an order reserves from its STATUS, not from its age", () => {
    // Pendiente reserves the window; En ruta / Entregado / Recolectado hold outright…
    expect(currentHoldings(CATALOG, order({ serviceStatusId: 1 })).rental).toBe(true);
    expect(currentHoldings(CATALOG, order({ serviceStatusId: 4 })).rental).toBe(true);
    // …and Listo is where they go back to the fleet, even though nothing was cancelled or deleted.
    expect(currentHoldings(CATALOG, order({ serviceStatusId: 6 })).rental).toBe(false);
    // A cancelled order holds nothing whatever step it was sitting on.
    expect(
      currentHoldings(CATALOG, order({ serviceStatusId: 3, cancelledAt: NOW })).rental,
    ).toBe(false);
    // A status that vanished from the catalog can hold nothing — the availability queries can't
    // see it either, so claiming a hold here would contradict them.
    expect(currentHoldings(CATALOG, order({ serviceStatusId: 999 })).rental).toBe(false);
  });

  it("holds SALE units from creation until the order is cancelled or delivered", () => {
    const sale = (overrides: Partial<LifecycleOrderModel> = {}) =>
      currentHoldings(CATALOG, order({ isRental: false, isSale: true, ...overrides })).sale;
    expect(sale()).toBe(true);
    expect(sale({ deliveredAt: NOW })).toBe(false); // the client HAS them
    expect(sale({ cancelledAt: NOW })).toBe(false); // handed back then
    // A pure rental order has no sale units to hold in the first place.
    expect(currentHoldings(CATALOG, order()).sale).toBe(false);
  });

  it("answers the question every confirm dialog asks", () => {
    const effect = (
      from: number,
      to: StatusDefinitionModel,
      kind: TransitionKindModel,
      overrides: Partial<LifecycleOrderModel> = {},
    ) => inventoryEffectOf(CATALOG, order({ serviceStatusId: from, ...overrides }), to, kind);

    // Forward within the holding stretch changes nothing…
    expect(effect(5, statusOf(3), "forward")).toBe("none");
    // …the step that ends the washing period gives them back…
    expect(effect(4, statusOf(6), "forward")).toBe("release");
    // …and stepping back into it takes them again (so it can fail on availability).
    expect(effect(6, statusOf(4), "backward")).toBe("reclaim");
    // Cancelling a holding order frees; cancelling a finished one promises nothing.
    expect(effect(3, statusOf(2), "disruptive")).toBe("release");
    expect(effect(6, statusOf(2), "disruptive")).toBe("none");
    // Reopening takes the goods back — including the sale units the cancel returned…
    expect(effect(2, statusOf(5), "reopen", { cancelledAt: NOW })).toBe("reclaim");
    // …but never the ones already delivered: those left the business for good.
    expect(
      effect(2, statusOf(6), "reopen", {
        cancelledAt: NOW,
        deliveredAt: NOW,
        isRental: false,
        isSale: true,
      }),
    ).toBe("none");
  });

  it("never claims a rental effect on a purchase-only order", () => {
    const purchase = order({ serviceStatusId: 5, isRental: false, isSale: true });
    // En ruta "holds" rental units — but this order has none, so only the sale rule can speak…
    expect(currentHoldings(CATALOG, purchase).rental).toBe(false);
    // …and cancelling it before delivery is exactly what puts those units back on the shelf.
    expect(inventoryEffectOf(CATALOG, purchase, statusOf(2), "disruptive")).toBe("release");
    expect(holdingsAfter(CATALOG, purchase, statusOf(3), "forward")).toEqual({
      rental: false,
      sale: true,
    });
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
        // En ruta and Entregado both hold the units — walking between them reserves nothing new.
        inventoryEffect: "none",
        purgesEvidence: false,
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
        inventoryEffect: "none",
        // En ruta demands no photos, so undoing it destroys nothing.
        purgesEvidence: false,
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
        // …but cancelling from a holding step DOES free them.
        inventoryEffect: "release",
        purgesEvidence: false,
      },
    ]);
  });

  it("rewinding INTO an evidence step never demands photos — but says it DESTROYS the ones it undoes", () => {
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
      // Recolectado — the step being LEFT — demanded photos, so this move deletes them for good.
      purgesEvidence: true,
    });
  });

  it("tells the truth about inventory on a FINISHED order: cancelling it frees nothing", () => {
    // Listo holds nothing (the units went back to the fleet when it was pressed), so the cancel
    // dialog must not promise that "los productos volverán a estar disponibles" — they already are.
    const finished = order({ serviceStatusId: 6 });
    expect(describeActions(CATALOG, finished, ADMIN, globals)).toEqual([
      expect.objectContaining({
        kind: "backward",
        statusName: "Recolectado",
        // …while stepping BACK into a holding step takes them again — the move that can 409.
        inventoryEffect: "reclaim",
        purgesEvidence: false,
      }),
      expect.objectContaining({
        kind: "disruptive",
        statusName: "Cancelado",
        inventoryEffect: "none",
      }),
    ]);
  });

  it("marks the forward step that RETURNS the units to the fleet", () => {
    // Recolectado (still held — there's a washing period) → Listo (free).
    expect(
      describeActions(CATALOG, order({ serviceStatusId: 4 }), ADMIN, globals),
    ).toContainEqual(
      expect.objectContaining({ kind: "forward", statusName: "Listo", inventoryEffect: "release" }),
    );
  });

  it("gives a stranger nothing to do", () => {
    expect(describeActions(CATALOG, order(), CLIENT, globals)).toEqual([]);
  });
});
