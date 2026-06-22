/* eslint-disable no-await-in-loop -- a seed is a one-off ops script; sequential
   upserts are intentional (ordering/clarity over micro-parallelism). */
import "dotenv/config";
import { logger } from "../src/config/logger.js";
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
 *     Employee=3), the token-type ids (Access=1, Refresh=2), and the
 *     Guatemala -> department -> municipality -> zone foreign-key chain.
 *
 * This runs ONLY via `pnpm prisma db seed` / `pnpm db:seed`. It is NOT part of
 * `prisma migrate deploy`, so deploying never re-touches existing data.
 *
 * NOTE: only reference/lookup data lives here — no users, no secrets, no PII.
 */
async function main(): Promise<void> {
  const prisma = await getPrismaClient();

  // user_roles — RolesEnum: Client=1, Admin=2, Employee=3
  const userRoles = [
    { id: 1, name: "Cliente", description: "Cliente que solicita el servicio" },
    { id: 2, name: "Administrador", description: "Administrador del sistema" },
    { id: 3, name: "Empleado", description: "Empleado del proveedor" },
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

  // service_status
  const serviceStatuses = [
    { id: 1, name: "Pendiente", description: "Servicio pendiente de entrega" },
    { id: 2, name: "Cancelado", description: "Servicio cancelado por el cliente o proveedor" },
    { id: 3, name: "Entregado", description: "Servicio entregado al cliente" },
    { id: 4, name: "Recolectado", description: "Servicio recolectado por el proveedor" },
  ];
  for (const row of serviceStatuses) {
    await prisma.serviceStatus.upsert({
      where: { id: row.id },
      update: { name: row.name, description: row.description },
      create: row,
    });
  }

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

  // zones (ids follow the original insert order: 1,2,4,5,9,10,14,15,16)
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
  ];
  for (const row of zones) {
    const description = `${row.name} de la Ciudad de Guatemala`;
    await prisma.zone.upsert({
      where: { id: row.id },
      update: { name: row.name, municipalityId: 1, description },
      create: { id: row.id, name: row.name, municipalityId: 1, description },
    });
  }

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
    "product_category",
    "service_status",
    "payment_status",
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
