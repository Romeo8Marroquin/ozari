import type { Prisma } from "@prisma/client";
import { appConfig } from "@/config/app.js";
import type { AccountPreferencesModel } from "./account.models.js";

type UserPreferenceClient = Pick<Prisma.TransactionClient, "userPreference">;

/**
 * A stored row → the published preferences. TOTAL: an absent row is all-defaults (nothing is ever
 * seeded), and a value a hand edit pushed outside the contract reads as the default rather than
 * starting every order at, say, 0 days — the forgiving stance `readSettingValue` takes for the
 * business-wide settings.
 */
export function projectAccountPreferences(
  row: { orderBilledDays: number | null } | null,
): AccountPreferencesModel {
  const days = row?.orderBilledDays ?? null;
  const valid =
    days !== null && Number.isInteger(days) && days >= 1 && days <= appConfig.maxBilledDays;
  return { orderBilledDays: valid ? days : null };
}

/** The person's preferences, defaults included. */
export async function loadAccountPreferences(
  client: UserPreferenceClient,
  userId: number,
): Promise<AccountPreferencesModel> {
  const row = await client.userPreference.findUnique({
    where: { userId },
    select: { orderBilledDays: true },
  });
  return projectAccountPreferences(row);
}

/**
 * Writes the FULL set (declarative, like every other settings door) and returns what was stored. An
 * `upsert`, because the first save of an account has no row to update — rows exist only once
 * somebody deviates from the defaults, and keeping one with every column back at `null` is harmless.
 */
export async function saveAccountPreferences(
  client: UserPreferenceClient,
  userId: number,
  preferences: AccountPreferencesModel,
): Promise<AccountPreferencesModel> {
  const row = await client.userPreference.upsert({
    where: { userId },
    update: { orderBilledDays: preferences.orderBilledDays },
    create: { userId, orderBilledDays: preferences.orderBilledDays },
    select: { orderBilledDays: true },
  });
  return projectAccountPreferences(row);
}
