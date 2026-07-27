import { describe, expect, it } from "vitest";
import { SEEDED_STATUS_CATALOG } from "@/tests/fixtures/lifecycleCatalog.js";
import type {
  LifecycleOrderModel,
  StatusDefinitionModel,
  TransitionKindModel,
} from "../lifecycle/lifecycle.models.js";
import {
  AdvanceOrderError,
  assertEvidenceSatisfies,
  buildTransitionData,
} from "./advance.service.js";

const CATALOG = SEEDED_STATUS_CATALOG;
const NOW = new Date("2026-08-01T15:00:00.000Z");

const statusOf = (id: number): StatusDefinitionModel =>
  CATALOG.find((status) => status.id === id) as StatusDefinitionModel;

const PENDIENTE = statusOf(1);
const CANCELADO = statusOf(2);
const ENTREGADO = statusOf(3);
const RECOLECTADO = statusOf(4);
const EN_RUTA = statusOf(5);
const LISTO = statusOf(6);

const order = (
  overrides: Partial<LifecycleOrderModel> = {},
): LifecycleOrderModel => ({
  serviceStatusId: 1,
  assignedUserId: 7,
  isRental: true,
  cancelledAt: null,
  ...overrides,
});

/** One transition over the SEEDED machine, with the clock frozen. */
const transition = (
  current: LifecycleOrderModel,
  from: StatusDefinitionModel | undefined,
  to: StatusDefinitionModel,
  kind: TransitionKindModel,
  reason?: string,
) =>
  buildTransitionData({
    catalog: CATALOG,
    order: current,
    from,
    to,
    kind,
    now: NOW,
    ...(reason !== undefined && { reason }),
  });

describe("buildTransitionData — forward", () => {
  it("stamps the actual the target step DECLARES, not one tied to an id", () => {
    expect(
      transition(order({ serviceStatusId: 5 }), EN_RUTA, ENTREGADO, "forward"),
    ).toEqual({
      serviceStatus: { connect: { id: 3 } },
      deliveredAt: NOW,
    });

    expect(
      transition(order({ serviceStatusId: 3 }), ENTREGADO, RECOLECTADO, "forward"),
    ).toEqual({
      serviceStatus: { connect: { id: 4 } },
      collectedAt: NOW,
    });
  });

  it("stamps nothing extra for a step that tracks no event", () => {
    expect(
      transition(order({ serviceStatusId: 1 }), PENDIENTE, EN_RUTA, "forward"),
    ).toEqual({ serviceStatus: { connect: { id: 5 } } });
  });

  it("stamps readyAt when the move COMPLETES the order's applicable pipeline", () => {
    // A rental finishes at Listo — the washing period is over, the units go back to the fleet.
    expect(
      transition(order({ serviceStatusId: 4 }), RECOLECTADO, LISTO, "forward"),
    ).toEqual({ serviceStatus: { connect: { id: 6 } }, readyAt: NOW });

    // A purchase-only order finishes at Entregado (collection/listo are RENTAL-only steps), with
    // its delivery actual and its completion stamped in the SAME move — no sale-specific branch.
    expect(
      transition(
        order({ serviceStatusId: 5, isRental: false }),
        EN_RUTA,
        ENTREGADO,
        "forward",
      ),
    ).toEqual({
      serviceStatus: { connect: { id: 3 } },
      deliveredAt: NOW,
      readyAt: NOW,
    });
  });
});

describe("buildTransitionData — backward", () => {
  it("clears the actual of the step being LEFT and un-completes the order", () => {
    expect(
      transition(order({ serviceStatusId: 3 }), ENTREGADO, EN_RUTA, "backward"),
    ).toEqual({
      serviceStatus: { connect: { id: 5 } },
      deliveredAt: null,
      readyAt: null,
    });

    expect(
      transition(order({ serviceStatusId: 4 }), RECOLECTADO, ENTREGADO, "backward"),
    ).toEqual({
      serviceStatus: { connect: { id: 3 } },
      collectedAt: null,
      readyAt: null,
    });
  });

  it("clears only the completion when the step being left tracked nothing", () => {
    // Listo → Recolectado: Listo stamps no actual, but the order stops being finished.
    expect(
      transition(order({ serviceStatusId: 6 }), LISTO, RECOLECTADO, "backward"),
    ).toEqual({ serviceStatus: { connect: { id: 4 } }, readyAt: null });

    // …and a vanished "from" status can't strand the rewind either.
    expect(transition(order(), undefined, PENDIENTE, "backward")).toEqual({
      serviceStatus: { connect: { id: 1 } },
      readyAt: null,
    });
  });
});

describe("buildTransitionData — disruptive", () => {
  it("stamps cancelledAt + the reason and leaves the actuals untouched", () => {
    expect(
      transition(
        order({ serviceStatusId: 3 }),
        ENTREGADO,
        CANCELADO,
        "disruptive",
        "El cliente canceló la fiesta",
      ),
    ).toEqual({
      serviceStatus: { connect: { id: 2 } },
      cancelledAt: NOW,
      cancelReason: "El cliente canceló la fiesta",
    });
  });

  it("records a null reason when none was given", () => {
    expect(
      transition(order(), PENDIENTE, CANCELADO, "disruptive"),
    ).toMatchObject({ cancelReason: null });
  });
});

describe("assertEvidenceSatisfies", () => {
  const bounds = { min: 2, max: 4 };

  it("passes when a demanding step gets enough photos", () => {
    expect(() =>
      assertEvidenceSatisfies(ENTREGADO, "forward", bounds, ["a", "b"]),
    ).not.toThrow();
  });

  it("rejects too few photos on a step that demands them", () => {
    expect(() =>
      assertEvidenceSatisfies(ENTREGADO, "forward", bounds, ["a"]),
    ).toThrow(AdvanceOrderError);
    try {
      assertEvidenceSatisfies(ENTREGADO, "forward", bounds, []);
    } catch (error) {
      expect(error).toMatchObject({
        kind: "evidence",
        detail: { required: 2, received: 0 },
      });
    }
  });

  it("never demands photos for a rewind or a cancel", () => {
    // The target still says `requiresEvidence`, but undoing/aborting must not need a camera.
    expect(() =>
      assertEvidenceSatisfies(ENTREGADO, "backward", bounds, []),
    ).not.toThrow();
    expect(() =>
      assertEvidenceSatisfies(CANCELADO, "disruptive", bounds, []),
    ).not.toThrow();
  });

  it("rejects more photos than the step allows, whatever the kind", () => {
    expect(() =>
      assertEvidenceSatisfies(EN_RUTA, "forward", bounds, ["a", "b", "c", "d", "e"]),
    ).toThrow(AdvanceOrderError);
  });

  it("accepts optional photos on a step that doesn't require them", () => {
    expect(() =>
      assertEvidenceSatisfies(EN_RUTA, "forward", bounds, ["a"]),
    ).not.toThrow();
  });
});
