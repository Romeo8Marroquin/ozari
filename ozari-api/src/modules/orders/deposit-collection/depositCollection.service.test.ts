import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  applyDeliveryDepositCollection,
  applyDepositCollection,
  planDepositCollection,
  type DepositCollectionStateModel,
} from "./depositCollection.service.js";

const NOW = new Date("2026-08-05T10:00:00Z");
const EARLIER = new Date("2026-08-01T15:00:00Z");
const PENDING: DepositCollectionStateModel = {
  depositReceivedAt: null,
  depositWaivedAt: null,
  depositWaivedReason: null,
};

describe("planDepositCollection", () => {
  it("receives a pending deposit now", () => {
    expect(planDepositCollection(PENDING, { received: true, reason: undefined }, NOW)).toEqual({
      data: { depositReceivedAt: NOW, depositWaivedAt: null, depositWaivedReason: null },
      kind: "RECEIVED",
      note: null,
    });
  });

  it("waives a pending deposit now, with its reason", () => {
    expect(planDepositCollection(PENDING, { received: false, reason: "Un familiar" }, NOW)).toEqual({
      data: { depositReceivedAt: null, depositWaivedAt: NOW, depositWaivedReason: "Un familiar" },
      kind: "WAIVED",
      note: "Un familiar",
    });
  });

  it("is mutually exclusive: receiving clears a waive, waiving clears a receipt", () => {
    const waived = { depositReceivedAt: null, depositWaivedAt: EARLIER, depositWaivedReason: "x" };
    expect(planDepositCollection(waived, { received: true, reason: undefined }, NOW)?.data).toEqual({
      depositReceivedAt: NOW,
      depositWaivedAt: null,
      depositWaivedReason: null,
    });
    const received = { ...PENDING, depositReceivedAt: EARLIER };
    expect(planDepositCollection(received, { received: false, reason: "y" }, NOW)?.data).toEqual({
      depositReceivedAt: null,
      depositWaivedAt: NOW,
      depositWaivedReason: "y",
    });
  });

  it("changes nothing on a re-send of the same answer (the first timestamp stands)", () => {
    expect(
      planDepositCollection({ ...PENDING, depositReceivedAt: EARLIER }, { received: true, reason: undefined }, NOW),
    ).toBeNull();
    expect(
      planDepositCollection(
        { depositReceivedAt: null, depositWaivedAt: EARLIER, depositWaivedReason: "x" },
        { received: false, reason: "x" },
        NOW,
      ),
    ).toBeNull();
  });

  it("a waive re-sent with a NEW reason keeps its timestamp and records the new reason", () => {
    expect(
      planDepositCollection(
        { depositReceivedAt: null, depositWaivedAt: EARLIER, depositWaivedReason: "x" },
        { received: false, reason: "otra razón" },
        NOW,
      ),
    ).toEqual({
      data: { depositReceivedAt: null, depositWaivedAt: EARLIER, depositWaivedReason: "otra razón" },
      kind: "WAIVED",
      note: "otra razón",
    });
  });

  it("stores a missing reason as NULL rather than undefined (defensive — the validator requires one)", () => {
    expect(planDepositCollection(PENDING, { received: false, reason: undefined }, NOW)?.note).toBeNull();
  });
});

const mockTx = () => ({
  service: { update: vi.fn().mockResolvedValue({}) },
  serviceDepositHistory: { create: vi.fn().mockResolvedValue({}) },
});

describe("applyDeliveryDepositCollection", () => {
  /** A live, unsettled order carrying 5 × Q40 = Q200 of deposit, still PENDING. */
  const order = (overrides: Record<string, unknown> = {}) => ({
    id: 12,
    ...PENDING,
    cancelledAt: null,
    depositSettledAt: null,
    serviceDetails: [
      { isRental: true, quantity: 5, securityDeposit: new Prisma.Decimal("40"), replacementPrice: null },
    ],
    ...overrides,
  });
  const run = (
    tx: ReturnType<typeof mockTx>,
    overrides: Partial<Parameters<typeof applyDeliveryDepositCollection>[1]> = {},
  ) =>
    applyDeliveryDepositCollection(tx as never, {
      order: order(),
      input: { received: true, reason: undefined },
      confirmsDelivery: true,
      byUserId: 7,
      now: NOW,
      ...overrides,
    });

  it("records the answer on a delivery of a still-pending deposit, at its nominal amount", async () => {
    const tx = mockTx();
    expect(await run(tx)).toBe(true);
    expect(tx.serviceDepositHistory.create).toHaveBeenCalledWith({
      data: { serviceId: 12, kind: "RECEIVED", note: null, depositTotal: 200, byUserId: 7 },
    });
  });

  it.each([
    ["no answer was sent", { input: undefined }],
    ["the move does not confirm the delivery", { confirmsDelivery: false }],
    ["the deposit was already received", { order: order({ depositReceivedAt: EARLIER }) }],
    ["the order carries no deposit", { order: order({ serviceDetails: [] }) }],
    ["the order is cancelled", { order: order({ cancelledAt: EARLIER }) }],
  ])("silently ignores it when %s", async (_label, overrides) => {
    const tx = mockTx();
    expect(await run(tx, overrides)).toBe(false);
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(tx.serviceDepositHistory.create).not.toHaveBeenCalled();
  });
});

describe("applyDepositCollection", () => {

  it("writes the columns and ONE trail row with the nominal deposit and the reason", async () => {
    const tx = mockTx();
    const changed = await applyDepositCollection(tx as never, {
      serviceId: 12,
      current: PENDING,
      input: { received: false, reason: "Un familiar" },
      depositTotal: 200,
      byUserId: 1,
      now: NOW,
    });
    expect(changed).toBe(true);
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { depositReceivedAt: null, depositWaivedAt: NOW, depositWaivedReason: "Un familiar" },
    });
    expect(tx.serviceDepositHistory.create).toHaveBeenCalledWith({
      data: { serviceId: 12, kind: "WAIVED", note: "Un familiar", depositTotal: 200, byUserId: 1 },
    });
  });

  it("writes nothing and appends no row when nothing changed", async () => {
    const tx = mockTx();
    const changed = await applyDepositCollection(tx as never, {
      serviceId: 12,
      current: { ...PENDING, depositReceivedAt: EARLIER },
      input: { received: true, reason: undefined },
      depositTotal: 200,
      byUserId: 1,
      now: NOW,
    });
    expect(changed).toBe(false);
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(tx.serviceDepositHistory.create).not.toHaveBeenCalled();
  });
});
