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
/**
 * A setting's shape, as a DISCRIMINATED UNION rather than one record with optional bounds.
 *
 * An `int` is always bounded and a `text` is always length-bounded, but by different fields — and
 * saying so in the type means neither the reader, the validator nor the client has a "what if this
 * one has no maximum" branch to get wrong. `multiline` belongs here, with the other constraints,
 * because it is a RULE about the value (a business name containing a newline is nonsense and the
 * validator rejects it), not a hint about which control to draw.
 */
export type SettingDefinition =
  | { key: string; group: string; type: "int"; min: number; max: number; fallback: number }
  | {
      key: string;
      group: string;
      type: "text";
      minLength: number;
      maxLength: number;
      multiline: boolean;
      /**
       * What KIND of text this is — a token about the VALUE, not an instruction about the control
       * (the `colorKey` doctrine: the API ships tokens, the client owns presentation). A client uses
       * it to offer the right keyboard; today only a phone needs saying, and everything else is
       * plain prose. Absent ⇒ plain.
       */
      format?: "phone";
      fallback: string;
    }
  // A switch. It carries no bounds because there is nothing to bound — which is the whole reason it
  // is its own arm rather than an int constrained to 0..1: a client narrowing on `type` gets a
  // boolean and a control to draw, instead of a number it has to know to render as a switch.
  | { key: string; group: string; type: "bool"; fallback: boolean };

/** A day, in minutes — the ceiling for the two clock rules. Anything larger stops being a spacing
 *  rule and becomes "don't take orders", which is not what this setting is for. */
const ONE_DAY_MINUTES = 24 * 60;

export const PREFERENCE_SETTINGS: readonly SettingDefinition[] = [
  {
    key: "orders.logisticsSpacingMinutes",
    group: "orders",
    type: "int",
    // At least a minute: zero would mean two deliveries at the same instant, which one van can't do.
    min: 1,
    max: ONE_DAY_MINUTES,
    fallback: appConfig.defaultLogisticsSpacingMinutes,
  },
  {
    key: "orders.turnaroundMinutes",
    group: "orders",
    type: "int",
    // ZERO is legitimate here, unlike spacing: a business with no cleaning step between rentals.
    min: 0,
    max: ONE_DAY_MINUTES,
    fallback: appConfig.defaultTurnaroundMinutes,
  },
  {
    key: "orders.evidenceMinPhotos",
    group: "evidence",
    type: "int",
    min: 1,
    max: 20,
    fallback: appConfig.defaultEvidenceMinPhotos,
  },
  {
    key: "orders.evidenceMaxPhotos",
    group: "evidence",
    type: "int",
    min: 1,
    max: 20,
    fallback: appConfig.defaultEvidenceMaxPhotos,
  },
  {
    key: "orders.evidenceRetentionMonths",
    group: "evidence",
    type: "int",
    // A month is the floor (evidence has to outlive the order it documents); ten years the ceiling.
    min: 1,
    max: 120,
    fallback: appConfig.defaultEvidenceRetentionMonths,
  },
  // Whether each create FORM keeps a silent draft of half-finished work (sessionStorage: survives a
  // refresh and a navigation, dies with the tab). ON by default, because losing twenty fields to a
  // mis-tapped back button is the failure worth preventing — but it IS a choice: on a shared machine
  // an admin may prefer that a half-typed order leaves nothing behind for the next shift.
  //
  // ONE SWITCH PER FORM (owner decision 2026-08-26), not a single global. The two forms are used by
  // different people at different moments — an order is filled with a client on the phone, a product
  // is set up once at a desk — so the answer for one is not the answer for the other. A form added
  // later gets its own key here; nothing about this shape has to change.
  {
    key: "forms.saveDraftOrders",
    group: "forms",
    type: "bool",
    fallback: appConfig.defaultSaveFormDrafts,
  },
  {
    key: "forms.saveDraftProducts",
    group: "forms",
    type: "bool",
    fallback: appConfig.defaultSaveFormDrafts,
  },
  // Everything a quote or order document says beyond the figures (EPIC-2-DOCUMENTS §6). It lives
  // here rather than in the template for the same reason the spacing rule does: it is business
  // policy the owner changes, not a constant a developer ships — and unlike an env var, changing one
  // is not a redeploy.
  //
  // THREE groups, because they are three different things and one heading ("Membrete") described
  // only the first (owner, 2026-08-26): `documents` is the LETTERHEAD — who the page is from;
  // `documentConditions` is what the page DECLARES about the deal; `legal` is the terms, which the
  // document never prints at all and the REGISTER screen publishes. Filing the terms under a
  // letterhead heading was simply wrong.
  {
    key: "documents.businessName",
    group: "documents",
    type: "text",
    // REQUIRED: this is the name at the top of the page. A document with no letterhead is broken,
    // so there is no legitimate empty state for it — unlike the phone and the terms below.
    minLength: 2,
    maxLength: 120,
    multiline: false,
    fallback: appConfig.defaultDocumentBusinessName,
  },
  {
    key: "documents.businessPhone",
    group: "documents",
    type: "text",
    // Optional: a business that prefers to be reached only through the app is a real choice, and
    // an empty footer line is far better than an invented number printed on every document.
    minLength: 0,
    maxLength: 60,
    multiline: false,
    // A phone number, so a client can offer the phone keypad rather than a prose keyboard.
    format: "phone",
    fallback: appConfig.defaultDocumentBusinessPhone,
  },
  {
    key: "documents.terms",
    // NOT the letterhead: the document never prints these (see below) — the REGISTER screen
    // publishes them through `GET /legal/terms`, which is the only place they are read.
    group: "legal",
    type: "text",
    minLength: 0,
    // A paragraph, not an essay. Note that a document does NOT transcribe this (owner decision
    // 2026-08-05, EPIC-2-DOCUMENTS §5): printing a wall of conditions on a quote makes it read like
    // a contract nobody signed, and it pushes the totals — the thing the client is actually looking
    // for — onto a second page. The document carries a short acceptance line REFERRING to these
    // terms; the text itself is stored here so it can be quoted, sent, or shown on request.
    maxLength: 1200,
    multiline: true,
    fallback: appConfig.defaultDocumentTerms,
  },
  {
    key: "documents.conditions",
    group: "documentConditions",
    type: "text",
    minLength: 0,
    // ONE LINE PER CONDITION, and deliberately short: this block is PRINTED on the page, unlike
    // `documents.terms` above. Four lines of about a hundred characters is the most a document can
    // carry without the conditions competing with the totals for the reader's attention — which is
    // the exact failure that made the full terms a referenced document rather than a transcribed one.
    maxLength: 400,
    multiline: true,
    fallback: appConfig.defaultDocumentConditions,
  },
  {
    key: "documents.freeDeliveryNote",
    group: "documentConditions",
    type: "text",
    minLength: 0,
    maxLength: 120,
    // A single sentence, so no newline: it is printed as one condition among the others.
    multiline: false,
    fallback: appConfig.defaultDocumentFreeDeliveryNote,
  },
  {
    key: "documents.quoteValidityDays",
    // How long the quote DECLARES itself valid for — something the page states about the deal, so
    // it belongs with the conditions rather than with the business's name and phone.
    group: "documentConditions",
    type: "int",
    // At least a day (a quote valid for zero days cannot be handed to anyone); a year is the
    // ceiling, past which "válida por N días" stops meaning anything.
    min: 1,
    max: 365,
    fallback: appConfig.defaultQuoteValidityDays,
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

/**
 * A stored value → a usable one, forced INTO the declared bounds.
 *
 * Every stored value is text (`app_preferences.value`), so this is where it becomes what the code
 * actually reads. A row hand-edited to something impossible resolves to its nearest legal value
 * rather than breaking a booking rule or printing a 4000-character "business name": an integer is
 * clamped, a text is TRUNCATED at its maximum, and a text that is too SHORT for a required setting
 * falls back — an empty `documents.businessName` is a missing configuration, not a choice.
 */
export function readSettingValue(
  definition: SettingDefinition,
  stored: string | undefined,
): number | string | boolean {
  if (definition.type === "bool") {
    // Only the two strings we write are accepted. Anything else — a missing row, a hand-edited
    // "yes", a leftover "1" — is a value we cannot honestly interpret, so it reads as the default
    // rather than as `false`: silently turning a feature OFF because a row is malformed is the more
    // surprising of the two failures.
    if (stored === "true") {
      return true;
    }
    if (stored === "false") {
      return false;
    }
    return definition.fallback;
  }
  if (definition.type === "text") {
    if (stored === undefined || stored.length < definition.minLength) {
      return definition.fallback;
    }
    return stored.slice(0, definition.maxLength);
  }
  const parsed = Number(stored);
  if (!Number.isInteger(parsed)) {
    return definition.fallback;
  }
  return Math.min(Math.max(parsed, definition.min), definition.max);
}

/** The published shape of ONE definition at its current value — the bounds travel with it so the
 *  client can enforce exactly what this module will enforce on save. */
const projectSetting = (
  definition: SettingDefinition,
  stored: string | undefined,
): PreferenceSettingModel => {
  const value = readSettingValue(definition, stored);
  if (definition.type === "bool") {
    return { key: definition.key, type: "bool", value: value === true, group: definition.group };
  }
  return definition.type === "text"
    ? {
        key: definition.key,
        type: "text",
        value: String(value),
        minLength: definition.minLength,
        maxLength: definition.maxLength,
        multiline: definition.multiline,
        ...(definition.format !== undefined && { format: definition.format }),
        group: definition.group,
      }
    : {
        key: definition.key,
        type: "int",
        value: Number(value),
        min: definition.min,
        max: definition.max,
        group: definition.group,
      };
};

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
  return PREFERENCE_SETTINGS.map((definition) =>
    projectSetting(definition, storedByKey.get(definition.key)),
  );
}

/**
 * Writes the settings. `upsert` rather than `update` because a setting can legitimately have no row
 * yet (added to the code after this database was seeded) — the write must create it rather than fail,
 * or the screen would be unusable exactly on the databases that need it most.
 */
export async function writeSettings(
  client: Pick<Prisma.TransactionClient, "appPreference">,
  settings: readonly { key: string; value: number | string | boolean }[],
): Promise<void> {
  await Promise.all(
    settings.map((setting) => {
      const definition = settingByKey.get(setting.key);
      return client.appPreference.upsert({
        where: { key: setting.key },
        update: { value: String(setting.value) },
        create: {
          key: setting.key,
          value: String(setting.value),
          // The stored `valueType` is how anything reading this table RAW (a seed, a migration, a
          // person) knows how to parse the text — so it has to follow the definition rather than be
          // hardcoded, or every text setting would announce itself as an integer.
          /* v8 ignore start -- the fallbacks can't fire through the endpoint (the validator only
             admits registry keys); they keep a future direct caller from writing an untyped,
             group-less row. */
          valueType: definition?.type ?? "int",
          group: definition?.group ?? "orders",
          /* v8 ignore stop */
        },
      });
    }),
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
