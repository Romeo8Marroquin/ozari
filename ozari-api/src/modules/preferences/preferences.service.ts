import { Prisma } from "@prisma/client";
import { appConfig } from "@/config/app.js";
import type { PreferenceSettingModel } from "./preferences.models.js";

/**
 * THE SETTINGS REGISTRY — the scalar `app_preferences` the admin may edit, and the only list of them.
 *
 * **Only settings the system actually HONOURS are here** (owner decision, 2026-07-29). The seed
 * carries twelve keys; the eight that nothing reads yet — reminder cadences, notification digests,
 * step-advance mode, `.ics` padding — are deliberately absent: a control that saves a value the code
 * ignores is worse than no control, because it teaches the admin not to trust the screen. When the
 * feature that honours one lands, it is added here in the same commit.
 *
 * `min`/`max` travel to the client so it can enforce the SAME bounds while typing that this module
 * enforces on save — the mirrored-validation doctrine, applied to settings.
 */
export interface SettingDefinition {
  key: string;
  group: string;
  min: number;
  max: number;
  fallback: number;
}

/** A day, in minutes — the ceiling for the two clock rules. Anything larger stops being a spacing
 *  rule and becomes "don't take orders", which is not what this setting is for. */
const ONE_DAY_MINUTES = 24 * 60;

export const PREFERENCE_SETTINGS: readonly SettingDefinition[] = [
  {
    key: "orders.logisticsSpacingMinutes",
    group: "orders",
    // At least a minute: zero would mean two deliveries at the same instant, which one van can't do.
    min: 1,
    max: ONE_DAY_MINUTES,
    fallback: appConfig.defaultLogisticsSpacingMinutes,
  },
  {
    key: "orders.turnaroundMinutes",
    group: "orders",
    // ZERO is legitimate here, unlike spacing: a business with no cleaning step between rentals.
    min: 0,
    max: ONE_DAY_MINUTES,
    fallback: appConfig.defaultTurnaroundMinutes,
  },
  {
    key: "orders.evidenceMinPhotos",
    group: "evidence",
    min: 1,
    max: 20,
    fallback: appConfig.defaultEvidenceMinPhotos,
  },
  {
    key: "orders.evidenceMaxPhotos",
    group: "evidence",
    min: 1,
    max: 20,
    fallback: appConfig.defaultEvidenceMaxPhotos,
  },
  {
    key: "orders.evidenceRetentionMonths",
    group: "evidence",
    // A month is the floor (evidence has to outlive the order it documents); ten years the ceiling.
    min: 1,
    max: 120,
    fallback: appConfig.defaultEvidenceRetentionMonths,
  },
];

const settingByKey = new Map(PREFERENCE_SETTINGS.map((setting) => [setting.key, setting]));

/**
 * The definition for an editable key, or `undefined` for anything else — which the endpoint REJECTS
 * rather than silently ignoring: a request naming an unknown or non-honoured key is a client bug, and
 * swallowing it costs a debugging session and leaves the admin believing they saved something.
 *
 * Returns the definition rather than a boolean so a caller that needs the bounds looks the key up
 * ONCE and has nothing left to narrow.
 */
export const settingDefinitionFor = (key: string): SettingDefinition | undefined =>
  settingByKey.get(key);

/** A stored text value → a usable integer, clamped INTO the declared bounds. A row hand-edited to
 *  something impossible reads as its nearest legal value rather than breaking a booking rule. */
export function readSettingValue(
  definition: SettingDefinition,
  stored: string | undefined,
): number {
  const parsed = Number(stored);
  if (!Number.isInteger(parsed)) {
    return definition.fallback;
  }
  return Math.min(Math.max(parsed, definition.min), definition.max);
}

/**
 * Every editable setting with its current value. Rows the table doesn't have yet resolve to their
 * seeded fallback, so the screen is complete on a database seeded before a setting existed — the
 * same forgiving stance `getEvidenceBounds` takes.
 */
export async function loadSettings(
  client: Pick<Prisma.TransactionClient, "appPreference">,
): Promise<PreferenceSettingModel[]> {
  const rows = await client.appPreference.findMany({
    where: { key: { in: PREFERENCE_SETTINGS.map((setting) => setting.key) } },
    select: { key: true, value: true },
  });
  const storedByKey = new Map(rows.map((row) => [row.key, row.value]));
  return PREFERENCE_SETTINGS.map((definition) => ({
    key: definition.key,
    type: "int" as const,
    value: readSettingValue(definition, storedByKey.get(definition.key)),
    min: definition.min,
    max: definition.max,
    group: definition.group,
  }));
}

/**
 * Writes the settings. `upsert` rather than `update` because a setting can legitimately have no row
 * yet (added to the code after this database was seeded) — the write must create it rather than fail,
 * or the screen would be unusable exactly on the databases that need it most.
 */
export async function writeSettings(
  client: Pick<Prisma.TransactionClient, "appPreference">,
  settings: readonly { key: string; value: number }[],
): Promise<void> {
  await Promise.all(
    settings.map((setting) =>
      client.appPreference.upsert({
        where: { key: setting.key },
        update: { value: String(setting.value) },
        create: {
          key: setting.key,
          value: String(setting.value),
          valueType: "int",
          /* v8 ignore next -- the `??` can't fire through the endpoint (the validator only admits
             registry keys); it keeps a future direct caller from writing a group-less row. */
          group: settingByKey.get(setting.key)?.group ?? "orders",
        },
      }),
    ),
  );
}

/** Raised when a catalog row can't be changed because the system needs it. */
export class PreferenceInvariantError extends Error {
  constructor(readonly reason: "lastActive") {
    super(reason);
    this.name = "PreferenceInvariantError";
  }
}

/** Raised when the addressed catalog or row doesn't exist. */
export class PreferenceNotFoundError extends Error {
  constructor() {
    super("notFound");
    this.name = "PreferenceNotFoundError";
  }
}
