import { describe, expect, it } from "vitest";
import { projectAccountPreferences } from "./account.service.js";

describe("projectAccountPreferences", () => {
  it("reads an absent row as all-defaults", () => {
    expect(projectAccountPreferences(null)).toEqual({ orderBilledDays: null });
  });

  it("keeps a stored value inside the contract", () => {
    expect(projectAccountPreferences({ orderBilledDays: 4 })).toEqual({ orderBilledDays: 4 });
  });

  it.each([0, -2, 366, 2.5])(
    "reads a hand-edited %s as the default rather than starting orders at nonsense",
    (days) => {
      expect(projectAccountPreferences({ orderBilledDays: days })).toEqual({
        orderBilledDays: null,
      });
    },
  );
});
