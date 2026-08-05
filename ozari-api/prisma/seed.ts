/* eslint-disable no-await-in-loop -- a seed is a one-off ops script; sequential
   upserts are intentional (ordering/clarity over micro-parallelism). */
import "dotenv/config";
import { logger } from "../src/config/logger.js";
import {
  InventoryHoldEnum,
  StatusAppliesToEnum,
  TrackedEventEnum,
} from "../src/models/enums/serviceLifecycleEnum.js";
import {
  disconnectPrisma,
  getPrismaClient,
} from "../src/services/prisma.service.js";

/**
 * Idempotent reference-data seed.
 *
 * Every row is upserted by its explicit primary key, so:
 *   - re-running this NEVER duplicates (safe against the already-seeded staging DB);
 *   - the exact ids the app depends on are preserved — RolesEnum (Client=1, Admin=2,
 *     Driver=3), the token-type ids (Access=1, Refresh=2), and the
 *     Guatemala -> department -> municipality -> zone foreign-key chain.
 *
 * This runs ONLY via `pnpm prisma db seed` / `pnpm db:seed`. It is NOT part of
 * `prisma migrate deploy`, so deploying never re-touches existing data.
 *
 * NOTE: only reference/lookup data lives here — no users, no secrets, no PII.
 */
type SeedPrismaClient = Awaited<ReturnType<typeof getPrismaClient>>;

// zones — the 22 zones of the Ciudad de Guatemala (numbers 1–25 EXCEPT 20/22/23, which fell into
// neighbouring municipalities). Ids 1–9 are the ORIGINAL insert order (1,2,4,5,9,10,14,15,16) and
// MUST NOT be renumbered — `client_registry_addresses.zone_id` / `addresses.zone_id` reference
// them. The remaining 13 zones are appended with new ids 10–22. `deliveryFee` is deliberately NOT
// in the upsert (stays NULL = "not configured"; re-seeding must never clobber an admin-set fee).
async function seedZones(prisma: SeedPrismaClient): Promise<void> {
  const zones = [
    { id: 1, name: "Zona 1" },
    { id: 2, name: "Zona 2" },
    { id: 3, name: "Zona 4" },
    { id: 4, name: "Zona 5" },
    { id: 5, name: "Zona 9" },
    { id: 6, name: "Zona 10" },
    { id: 7, name: "Zona 14" },
    { id: 8, name: "Zona 15" },
    { id: 9, name: "Zona 16" },
    { id: 10, name: "Zona 3" },
    { id: 11, name: "Zona 6" },
    { id: 12, name: "Zona 7" },
    { id: 13, name: "Zona 8" },
    { id: 14, name: "Zona 11" },
    { id: 15, name: "Zona 12" },
    { id: 16, name: "Zona 13" },
    { id: 17, name: "Zona 17" },
    { id: 18, name: "Zona 18" },
    { id: 19, name: "Zona 19" },
    { id: 20, name: "Zona 21" },
    { id: 21, name: "Zona 24" },
    { id: 22, name: "Zona 25" },
  ];
  for (const row of zones) {
    const description = `${row.name} de la Ciudad de Guatemala`;
    await prisma.zone.upsert({
      where: { id: row.id },
      update: { name: row.name, municipalityId: 1, description },
      create: { id: row.id, name: row.name, municipalityId: 1, description },
    });
  }
}

// service_status — THE ORDER LIFECYCLE MACHINE, seeded as the business's real flow (EPIC-2 order
// lifecycle, 2026-07-27). Every row DECLARES its own behavior, so the admin can rename/recolor/
// reorder/add steps without a deploy:
//   pipeline  Pendiente(1) → En ruta(2) → Entregado(3) → Recolectado(4) → Listo(5)
//   off-ramp  Cancelado (sortOrder NULL, `isDisruptive` — reachable from any step)
// Ids are the historical seed anchors (`ServiceStatusEnum`); **Listo (id 6) is the only new row** —
// the washing period between collection and the fleet getting its units back (owner, 2026-07-27),
// which is why Recolectado still holds inventory (`OUT`) and only Listo releases it (`NONE`).
const SERVICE_STATUS_SEED = [
  {
    id: 1,
    name: "Pendiente",
    description: "Pedido confirmado, pendiente de entrega",
    sortOrder: 1,
    isInitial: true,
    isDisruptive: false,
    inventoryHold: InventoryHoldEnum.WINDOW,
    requiresEvidence: false,
    minEvidence: null,
    maxEvidence: null,
    appliesTo: StatusAppliesToEnum.ALL,
    tracksEvent: null,
    colorKey: "amber",
  },
  {
    id: 5,
    name: "En ruta",
    description: "Pedido cargado y en camino hacia el cliente",
    sortOrder: 2,
    isInitial: false,
    isDisruptive: false,
    inventoryHold: InventoryHoldEnum.OUT,
    requiresEvidence: false,
    minEvidence: null,
    maxEvidence: null,
    appliesTo: StatusAppliesToEnum.ALL,
    tracksEvent: null,
    colorKey: "indigo",
  },
  {
    id: 3,
    name: "Entregado",
    description: "Pedido entregado al cliente",
    sortOrder: 3,
    isInitial: false,
    isDisruptive: false,
    inventoryHold: InventoryHoldEnum.OUT,
    requiresEvidence: true,
    minEvidence: null,
    maxEvidence: null,
    appliesTo: StatusAppliesToEnum.ALL,
    tracksEvent: TrackedEventEnum.DELIVERY,
    colorKey: "emerald",
  },
  {
    id: 4,
    name: "Recolectado",
    description:
      "Pedido recolectado; en proceso de limpieza (las unidades aún no vuelven a la flota)",
    sortOrder: 4,
    isInitial: false,
    isDisruptive: false,
    inventoryHold: InventoryHoldEnum.OUT,
    requiresEvidence: true,
    minEvidence: null,
    maxEvidence: null,
    appliesTo: StatusAppliesToEnum.RENTAL,
    tracksEvent: TrackedEventEnum.COLLECTION,
    colorKey: "sky",
  },
  {
    id: 6,
    name: "Listo",
    description: "Pedido finalizado: unidades limpias y de vuelta en la flota",
    sortOrder: 5,
    isInitial: false,
    isDisruptive: false,
    inventoryHold: InventoryHoldEnum.NONE,
    requiresEvidence: false,
    minEvidence: null,
    maxEvidence: null,
    appliesTo: StatusAppliesToEnum.RENTAL,
    tracksEvent: null,
    colorKey: "violet",
  },
  {
    id: 2,
    name: "Cancelado",
    description: "Pedido cancelado por el cliente o por el proveedor",
    sortOrder: null,
    isInitial: false,
    isDisruptive: true,
    inventoryHold: InventoryHoldEnum.NONE,
    requiresEvidence: false,
    minEvidence: null,
    maxEvidence: null,
    appliesTo: StatusAppliesToEnum.ALL,
    tracksEvent: null,
    colorKey: "red",
  },
];

/** `pnpm db:seed:force` (i.e. `prisma db seed -- --force`) — the explicit opt-in that RESTORES the
 *  seeded lifecycle defaults over admin edits (owner decision 2026-07-27). Plain `pnpm db:seed`
 *  never touches an edited status. */
const forceSeed = (): boolean => process.argv.includes("--force");

/**
 * Writes the seeded lifecycle defaults onto the seeded rows. `sort_order` is UNIQUE, so every
 * pipeline slot is freed first — assigning targets in place would collide with whatever holds them
 * (a previous admin reorder). Admin-created steps keep their relative order, renumbered after the
 * seeded ones, so restoring the defaults never strands a custom step.
 */
async function applyLifecycleDefaults(
  prisma: SeedPrismaClient,
  force: boolean,
): Promise<void> {
  const pipelineRows = await prisma.serviceStatus.findMany({
    where: { sortOrder: { not: null } },
    select: { id: true },
    orderBy: { sortOrder: "asc" },
  });
  await prisma.serviceStatus.updateMany({
    where: { sortOrder: { not: null } },
    data: { sortOrder: null },
  });

  for (const { id, name, description, ...machine } of SERVICE_STATUS_SEED) {
    await prisma.serviceStatus.update({
      where: { id },
      // A backfill fixes only the MACHINE columns (the admin never chose an empty configuration);
      // `--force` additionally restores the seeded name/description and re-publishes the row.
      data: force
        ? { ...machine, name, description, isActive: true }
        : machine,
    });
  }

  const seededIds = new Set(SERVICE_STATUS_SEED.map((row) => row.id));
  let nextSlot =
    SERVICE_STATUS_SEED.filter((row) => row.sortOrder !== null).length + 1;
  for (const row of pipelineRows.filter((row) => !seededIds.has(row.id))) {
    await prisma.serviceStatus.update({
      where: { id: row.id },
      data: { sortOrder: nextSlot },
    });
    nextSlot += 1;
  }
}

/**
 * Seeds the lifecycle statuses. Rows are CREATE-ONLY on re-run (the `app_preferences` stance): once
 * the admin renames, recolors or re-flags a status, re-seeding must never undo it. Two exceptions:
 *   - a DB seeded BEFORE the machine existed has all-default flag columns — that is a MISSING
 *     configuration, not an admin choice, so the defaults are backfilled exactly once (detected
 *     globally: any configured row ⇒ hands off);
 *   - `--force` deliberately restores everything.
 */
async function seedServiceStatuses(
  prisma: SeedPrismaClient,
  force: boolean,
): Promise<void> {
  const configuredBefore = await prisma.serviceStatus.count({
    where: { OR: [{ sortOrder: { not: null } }, { isInitial: true }] },
  });
  for (const row of SERVICE_STATUS_SEED) {
    await prisma.serviceStatus.upsert({
      where: { id: row.id },
      update: {},
      create: row,
    });
  }
  if (force || configuredBefore === 0) {
    await applyLifecycleDefaults(prisma, force);
  }
}

// app_preferences — every operational "constant" is an admin preference (owner direction,
// 2026-07-15; EPIC-2-ORDERS §2). CREATE-ONLY upserts (`update: {}`): re-seeding must NEVER
// clobber a value the admin has since edited. Values are text, parsed per valueType.
async function seedAppPreferences(prisma: SeedPrismaClient): Promise<void> {
  const appPreferences = [
    {
      key: "orders.logisticsSpacingMinutes",
      value: "60",
      valueType: "int",
      group: "orders",
      description:
        "Minutos mínimos entre dos eventos logísticos (entrega/recolección) del mismo responsable, incluidos los del propio pedido",
    },
    {
      key: "orders.turnaroundMinutes",
      value: "120",
      valueType: "int",
      group: "orders",
      description:
        "Minutos estándar de limpieza tras la recolección antes del recordatorio de listo",
    },
    {
      key: "orders.readyReminderIntervalMinutes",
      value: "60",
      valueType: "int",
      group: "orders",
      description:
        "Cada cuántos minutos se recuerda presionar listo tras el tiempo de limpieza",
    },
    {
      key: "orders.calendarPaddingMinutes",
      value: "30",
      valueType: "int",
      group: "orders",
      description:
        "Minutos de holgura antes y después de cada evento en el calendario",
    },
    {
      key: "orders.defaultEventMinLeadHours",
      value: "24",
      valueType: "int",
      group: "orders",
      description:
        "Horas mínimas de anticipación por defecto para nuevos tipos de evento",
    },
    // The GLOBAL evidence bounds — the range a per-status count may be chosen from, and the
    // fallback when a status leaves `min_evidence`/`max_evidence` NULL (owner decision 2026-07-27).
    // WHETHER a step demands photos is the per-status `requires_evidence` flag, not a preference
    // (which is why the old global `orders.evidencePhotosRequired` switch is gone from this seed).
    {
      key: "orders.evidenceMinPhotos",
      value: "1",
      valueType: "int",
      group: "orders",
      description:
        "Mínimo global de fotos de evidencia por paso (y mínimo permitido al configurar un estado)",
    },
    // How long evidence photos are KEPT. Nothing enforces this automatically yet — it is the cutoff
    // `pnpm purge:evidence` uses when run without an explicit `--before`, so the policy has ONE home
    // whether it's run by hand today or by an admin screen / scheduled job later. Only the PHOTOS
    // are ever purged; the orders and their status history are permanent.
    {
      key: "orders.evidenceRetentionMonths",
      value: "24",
      valueType: "int",
      group: "orders",
      description:
        "Meses que se conservan las fotos de evidencia antes de poder depurarlas (los pedidos y su historial nunca se borran)",
    },
    {
      key: "orders.evidenceMaxPhotos",
      value: "10",
      valueType: "int",
      group: "orders",
      description:
        "Máximo global de fotos de evidencia por paso (y máximo permitido al configurar un estado)",
    },
    {
      key: "orders.stepAdvanceMode",
      value: "tap",
      valueType: "string",
      group: "orders",
      description:
        "Cómo avanzan los pasos de una orden: confirmación manual (tap) o automática por tiempo (time)",
    },
    {
      key: "notifications.digestFrequency",
      value: "daily",
      valueType: "string",
      group: "notifications",
      description:
        "Frecuencia del resumen de próximas entregas (daily | weekly | off)",
    },
    {
      key: "notifications.deliveryReminderMinutes",
      value: "60",
      valueType: "int",
      group: "notifications",
      description: "Minutos antes de una entrega para el recordatorio individual",
    },
    {
      key: "products.defaultRentTimeUnitId",
      value: "2",
      valueType: "int",
      group: "products",
      description:
        "Unidad de tiempo de alquiler por defecto en el formulario de productos (2 = Día)",
    },
    // documents.* — el membrete de las cotizaciones y comprobantes (EPIC-2-DOCUMENTS §6). El
    // teléfono y los términos nacen VACÍOS a propósito: inventar un número imprimiría uno
    // equivocado en cada documento, y unos términos sin escribir son simplemente un documento sin
    // ese párrafo. El administrador los llena en Preferencias → Documentos.
    {
      key: "documents.businessName",
      value: "Party Rentals GT",
      valueType: "text",
      group: "documents",
      description: "Nombre del negocio en el membrete de cotizaciones y comprobantes",
    },
    {
      key: "documents.businessPhone",
      value: "",
      valueType: "text",
      group: "documents",
      description: "Teléfono de contacto al pie de los documentos",
    },
    {
      key: "documents.terms",
      value: "",
      valueType: "text",
      group: "documents",
      description:
        "Términos y condiciones impresos al pie de la última página de cada documento",
    },
    {
      key: "documents.quoteValidityDays",
      value: "15",
      valueType: "int",
      group: "documents",
      description: "Días de vigencia que declara una cotización",
    },
  ];
  for (const row of appPreferences) {
    await prisma.appPreference.upsert({
      where: { key: row.key },
      update: {},
      create: row,
    });
  }

  // RETIRED keys — swept so nothing dead accumulates (the no-trash policy applies to preferences
  // too). `orders.evidencePhotosRequired` was a single global switch; whether a step demands photos
  // is now the PER-STATUS `service_status.requires_evidence` flag (EPIC-2 order lifecycle,
  // 2026-07-27), so the old row could only ever mislead. Safe + idempotent: no code reads it.
  await prisma.appPreference.deleteMany({
    where: { key: { in: ["orders.evidencePhotosRequired"] } },
  });
}

async function main(): Promise<void> {
  const prisma = await getPrismaClient();

  // user_roles — RolesEnum: Client=1, Admin=2, Driver=3. Role 3 was renamed
  // "Empleado" → "Repartidor" (Epic-2A, 2026-07-16): employees are exclusively
  // drivers for now; re-running the seed updates the existing row in place.
  const userRoles = [
    { id: 1, name: "Cliente", description: "Cliente que solicita el servicio" },
    { id: 2, name: "Administrador", description: "Administrador del sistema" },
    {
      id: 3,
      name: "Repartidor",
      description: "Repartidor encargado de entregas y recolecciones",
    },
  ];
  for (const row of userRoles) {
    await prisma.userRole.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  // token_types — TokenEnum DB session types: ACCESS_TOKEN=1, REFRESH_TOKEN=2.
  // (MFA_TOKEN is stateless and intentionally has no row.)
  const tokenTypes = [
    {
      id: 1,
      name: "Access",
      description:
        "Token de acceso de corta duración para autenticar solicitudes",
    },
    {
      id: 2,
      name: "Refresh",
      description: "Token de renovación para generar nuevos access tokens",
    },
  ];
  for (const row of tokenTypes) {
    await prisma.tokenType.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  // currencies
  await prisma.currency.upsert({
    where: { id: 1 },
    update: {
      name: "Quetzal Guatemalteco",
      description: "Moneda oficial de Guatemala",
      iso4217Code: "GTQ",
      symbol: "Q",
    },
    create: {
      id: 1,
      name: "Quetzal Guatemalteco",
      description: "Moneda oficial de Guatemala",
      iso4217Code: "GTQ",
      symbol: "Q",
    },
  });

  // countries -> departments -> municipalities (FK chain assumes id = 1 each)
  await prisma.country.upsert({
    where: { id: 1 },
    update: { name: "Guatemala", description: "Republica de Guatemala" },
    create: { id: 1, name: "Guatemala", description: "Republica de Guatemala" },
  });
  await prisma.countryDepartment.upsert({
    where: { id: 1 },
    update: {
      name: "Guatemala",
      countryId: 1,
      description: "Departamento de Guatemala",
    },
    create: {
      id: 1,
      name: "Guatemala",
      countryId: 1,
      description: "Departamento de Guatemala",
    },
  });
  await prisma.municipality.upsert({
    where: { id: 1 },
    update: {
      name: "Ciudad de Guatemala",
      departmentId: 1,
      description: "Municipio capital de Guatemala",
    },
    create: {
      id: 1,
      name: "Ciudad de Guatemala",
      departmentId: 1,
      description: "Municipio capital de Guatemala",
    },
  });

  // user_phone_types (note: this model's label column is `type`, not `name`)
  const phoneTypes = [
    { id: 1, type: "Whatsapp", description: "Número asociado a WhatsApp" },
    { id: 2, type: "Móvil", description: "Número de teléfono móvil" },
  ];
  for (const row of phoneTypes) {
    await prisma.userPhoneType.upsert({
      where: { id: row.id },
      update: { type: row.type, description: row.description },
      create: row,
    });
  }

  // product_business_type
  const businessTypes = [
    { id: 1, name: "Alquiler", description: "Alquiler de mobiliario para fiesta" },
    { id: 2, name: "Venta", description: "Venta de consumibles para fiesta" },
  ];
  for (const row of businessTypes) {
    await prisma.productBusinessType.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  // rent_time_units — RentTimeUnitEnum: Hora=1, Día=2, Semana=3, Mes=4, Evento=5.
  // The period an Alquiler product's rentPrice is quoted against; "Evento" is a flat
  // per-event rate (duration-agnostic). "Día" (id 2) is the form default at create time.
  const rentTimeUnits = [
    { id: 1, name: "Hora", description: "Precio de alquiler por hora" },
    { id: 2, name: "Día", description: "Precio de alquiler por día" },
    { id: 3, name: "Semana", description: "Precio de alquiler por semana" },
    { id: 4, name: "Mes", description: "Precio de alquiler por mes" },
    {
      id: 5,
      name: "Evento",
      description: "Tarifa plana por evento, independiente de la duración",
    },
  ];
  for (const row of rentTimeUnits) {
    await prisma.rentTimeUnit.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  // product_category
  const categories = [
    { id: 1, name: "Mesas", description: "Mesas rígidas con patas plegables para fiesta" },
    { id: 2, name: "Sillas", description: "Sillas de jardín blanca para fiesta" },
    { id: 3, name: "Mobiliario", description: "Mobiliario para fiesta" },
    { id: 4, name: "Mantelería", description: "Mantelería para fiesta" },
    { id: 5, name: "Accesorios", description: "Accesorios para fiesta" },
    { id: 6, name: "Decoración", description: "Decoración para fiesta" },
    { id: 7, name: "Otros", description: "Otros productos para fiesta" },
  ];
  for (const row of categories) {
    await prisma.productCategory.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  await seedServiceStatuses(prisma, forceSeed());

  // payment_status
  const paymentStatuses = [
    { id: 1, name: "Pendiente", description: "Pago pendiente por parte del cliente" },
    { id: 2, name: "Pagado", description: "Pago confirmado por proveedor" },
    { id: 3, name: "Reembolsado", description: "Pago reembolsado al cliente" },
  ];
  for (const row of paymentStatuses) {
    await prisma.paymentStatus.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  // payment_methods — HOW an order is paid (owner 2026-07-23). Efectivo / Transferencia for now;
  // the card door stays open (add a row, no schema change).
  const paymentMethods = [
    { id: 1, name: "Efectivo", description: "Pago en efectivo" },
    { id: 2, name: "Transferencia", description: "Transferencia bancaria" },
  ];
  for (const row of paymentMethods) {
    await prisma.paymentMethod.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  // event_types — the purpose of an order (owner taxonomy, 2026-07-16). `minLeadHours` (default
  // 24, deliberately NOT updated on re-run — it's an admin-tunable knob) is the client-side rule:
  // create only if delivery is ≥ that far away, edit/cancel only until that many hours before.
  const eventTypes = [
    {
      id: 1,
      name: "Evento familiar",
      description: "Celebración familiar (cumpleaños, reunión, aniversario)",
    },
    {
      id: 2,
      name: "Evento social",
      description: "Evento social o comunitario",
    },
    { id: 3, name: "Otro", description: "Otro tipo de evento" },
  ];
  for (const row of eventTypes) {
    await prisma.eventType.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  // contact_types — channels for client-registry contacts (deliberately separate from
  // user_phone_types: registry contacts include non-phone channels like email).
  const contactTypes = [
    { id: 1, name: "WhatsApp", description: "Número de WhatsApp" },
    { id: 2, name: "Teléfono", description: "Número de teléfono" },
    {
      id: 3,
      name: "Correo electrónico",
      description: "Dirección de correo electrónico",
    },
    { id: 4, name: "Otro", description: "Otro medio de contacto" },
  ];
  for (const row of contactTypes) {
    await prisma.contactType.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  // product_detail_types
  const detailTypes = [
    { id: 1, name: "Color", description: "Color del producto" },
    { id: 2, name: "Material", description: "Material del producto" },
    { id: 3, name: "Dimensiones", description: "Dimensiones del producto" },
    { id: 4, name: "Capacidad", description: "Capacidad del producto" },
    { id: 5, name: "Peso", description: "Peso del producto" },
  ];
  for (const row of detailTypes) {
    await prisma.productDetailType.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

  await seedZones(prisma);

  await seedAppPreferences(prisma);

  // Because we upsert with explicit ids, the serial sequences are not advanced.
  // Reset each to MAX(id) so a fresh DB doesn't collide on the next app insert.
  // (Idempotent + harmless on the already-seeded staging DB. Table names are fixed
  // constants here, never user input.)
  const serialTables = [
    "user_roles",
    "token_types",
    "currencies",
    "countries",
    "departments",
    "municipalities",
    "user_phone_types",
    "product_business_type",
    "rent_time_units",
    "product_category",
    "service_status",
    "payment_status",
    "payment_methods",
    "event_types",
    "contact_types",
    "product_detail_types",
    "zones",
  ];
  for (const table of serialTables) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table}))`,
    );
  }

  logger.info("Seed completed (idempotent upserts + sequence reset).");
}

main()
  .catch((error: unknown) => {
    logger.error("Seed failed", { error });
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
