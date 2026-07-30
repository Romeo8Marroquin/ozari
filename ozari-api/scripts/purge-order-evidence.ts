/* eslint-disable no-console -- local ops script: the console report IS its product */
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { getPrismaClient } from "../src/services/prisma.service.js";

/**
 * ORDER-EVIDENCE RETENTION PURGE — a LOCAL developer/ops script, never deployed (it lives outside
 * `src/`, so neither `tsc --project tsconfig.build.json` nor the Docker runner image include it).
 * English-only output on purpose: local telemetry, not user-facing copy.
 *
 * WHY it exists: every tracking step that demands evidence stores photos in R2 forever. At ~5 photos
 * per order, a couple of busy years is tens of thousands of objects that nobody will ever open
 * again — the delivery was completed, paid and closed. This deletes the PHOTOS (the R2 objects and
 * their `service_evidence` rows) of orders finished before a cutoff, and **nothing else**: the
 * orders, their lines, their money and their status history all stay exactly as they were. The
 * business record is untouched; only the storage bill shrinks.
 *
 * Usage (from `ozari-api/`, reads `.env` for DATABASE_URL + the R2_* vars):
 *
 *   pnpm purge:evidence                          # REPORT ONLY, cutoff = the configured retention
 *   pnpm purge:evidence -- --before=2026-01-01   # REPORT ONLY, explicit cutoff
 *   pnpm purge:evidence -- --before=2026-01-01 --fix   # apply
 *
 * With no `--before`, the cutoff comes from the `orders.evidenceRetentionMonths` app preference
 * (seeded at 24) — the same knob a future admin screen would edit, so the policy has ONE home
 * whether it's run by hand today or by a scheduled job later.
 *
 * Safety rules:
 *  - Only evidence of FINISHED orders is ever considered — an order is finished when its "listo"
 *    was pressed (`ready_at`) or it was cancelled (`cancelled_at`). Photos of an order still in
 *    flight, or one that never completed, are never touched however old they are: those are exactly
 *    the ones a dispute would need. `--include-unfinished` overrides this deliberately.
 *  - Rows are deleted in ONE transaction that RE-VERIFIES each row inside it (still old, still
 *    finished); anything that changed since the scan is skipped and reported.
 *  - R2 objects are deleted AFTER the commit, batched (≤1000/call), and every per-key failure is
 *    reported. A failed object delete leaves a harmless orphan that `pnpm reconcile:images` style
 *    sweeps can clean later — never a row pointing at a deleted file.
 *
 * Exit codes: 0 = nothing to purge (or purged cleanly) · 1 = dry run found photos to purge ·
 * 2 = an error occurred (bad args, env, query, transaction, or any per-key R2 failure).
 */

const DEFAULT_RETENTION_MONTHS = 24;
const R2_DELETE_BATCH = 1000;
/** How many per-order lines the report prints before collapsing into a count. */
const REPORT_LIMIT = 20;

interface Args {
  fix: boolean;
  before: Date | null;
  includeUnfinished: boolean;
}

interface EvidenceRow {
  id: number;
  r2Key: string;
  serviceId: number;
  createdAt: Date;
}

function parseArgs(argv: string[]): Args {
  const fix = argv.includes("--fix");
  const includeUnfinished = argv.includes("--include-unfinished");
  const beforeArg = argv.find((arg) => arg.startsWith("--before="));
  if (!beforeArg) {
    return { fix, before: null, includeUnfinished };
  }
  const raw = beforeArg.split("=")[1] ?? "";
  const before = new Date(raw);
  if (Number.isNaN(before.getTime())) {
    throw new Error(`Invalid --before value: "${raw}" (expected YYYY-MM-DD)`);
  }
  if (before.getTime() > Date.now()) {
    throw new Error(`--before is in the FUTURE (${before.toISOString()}) — refusing to purge`);
  }
  return { fix, before, includeUnfinished };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (run from ozari-api/ with a filled .env)`);
  }
  return value;
}

/** The cutoff: the explicit `--before`, else now minus the configured retention window. */
async function resolveCutoff(
  prisma: Awaited<ReturnType<typeof getPrismaClient>>,
  explicit: Date | null,
): Promise<{ cutoff: Date; source: string }> {
  if (explicit) {
    return { cutoff: explicit, source: "--before" };
  }
  const preference = await prisma.appPreference.findUnique({
    where: { key: "orders.evidenceRetentionMonths" },
    select: { value: true },
  });
  const parsed = Number(preference?.value);
  const months =
    Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_MONTHS;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return {
    cutoff,
    source: preference
      ? `orders.evidenceRetentionMonths = ${months}`
      : `default ${months} months (preference not seeded)`,
  };
}

/** Group the doomed photos by order, for a report that reads like the business, not like a table. */
function printReport(rows: [EvidenceRow, ...EvidenceRow[]]): void {
  const byOrder = new Map<number, number>();
  for (const row of rows) {
    byOrder.set(row.serviceId, (byOrder.get(row.serviceId) ?? 0) + 1);
  }
  const orders = [...byOrder.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nPhotos to purge: ${rows.length} across ${orders.length} finished order(s)`);
  for (const [serviceId, count] of orders.slice(0, REPORT_LIMIT)) {
    console.log(`  - order ${serviceId}: ${count} photo(s)`);
  }
  if (orders.length > REPORT_LIMIT) {
    console.log(`  … and ${orders.length - REPORT_LIMIT} more order(s)`);
  }
  // The scan is ordered oldest-first, so the span is simply the ends of the list.
  const oldest = rows[0].createdAt;
  const newest = rows[rows.length - 1]?.createdAt ?? oldest;
  console.log(`  span: ${oldest.toISOString().slice(0, 10)} → ${newest.toISOString().slice(0, 10)}`);
}

/** Delete the rows in ONE transaction, re-verifying each inside it. Returns the keys actually freed
 *  — only those objects are then removed from R2, so a skipped row never loses its photo. */
async function deleteRows(
  prisma: Awaited<ReturnType<typeof getPrismaClient>>,
  rows: EvidenceRow[],
  cutoff: Date,
  includeUnfinished: boolean,
): Promise<string[]> {
  const ids = rows.map((row) => row.id);
  return prisma.$transaction(async (tx) => {
    const current = await tx.serviceEvidence.findMany({
      where: {
        id: { in: ids },
        createdAt: { lt: cutoff },
        ...(includeUnfinished
          ? {}
          : {
              service: {
                OR: [{ readyAt: { not: null } }, { cancelledAt: { not: null } }],
              },
            }),
      },
      select: { id: true, r2Key: true },
    });
    const skipped = ids.length - current.length;
    if (skipped > 0) {
      console.log(`  ! ${skipped} row(s) changed since the scan — SKIPPED (re-run to re-evaluate)`);
    }
    if (current.length === 0) {
      return [];
    }
    await tx.serviceEvidence.deleteMany({
      where: { id: { in: current.map((row) => row.id) } },
    });
    return current.map((row) => row.r2Key);
  });
}

/** Delete the freed objects in ≤1000-key batches, logging every per-key failure. */
async function deleteObjects(
  s3: S3Client,
  bucket: string,
  keys: string[],
  errors: string[],
): Promise<number> {
  let deleted = 0;
  for (let start = 0; start < keys.length; start += R2_DELETE_BATCH) {
    const batch = keys.slice(start, start + R2_DELETE_BATCH);
    // eslint-disable-next-line no-await-in-loop -- batches run sequentially (clear logs, gentle on R2)
    const response = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: false },
      }),
    );
    deleted += response.Deleted?.length ?? 0;
    for (const failure of response.Errors ?? []) {
      const message = `R2 delete failed for ${failure.Key}: ${failure.Code} ${failure.Message}`;
      errors.push(message);
      console.error(`  ! ${message}`);
    }
  }
  return deleted;
}

async function main(): Promise<number> {
  const { fix, before, includeUnfinished } = parseArgs(process.argv.slice(2));

  console.log("── Order-evidence retention purge ──────────────────────────────");
  requireEnv("DATABASE_URL");
  const bucket = requireEnv("R2_BUCKET_NAME");
  const prisma = await getPrismaClient();
  const { cutoff, source } = await resolveCutoff(prisma, before);

  console.log(`Mode:   ${fix ? "PURGE (will delete)" : "REPORT ONLY (dry run — pass --fix to apply)"}`);
  console.log(`Cutoff: ${cutoff.toISOString()} (from ${source})`);
  console.log(
    `Scope:  ${includeUnfinished ? "ALL orders (--include-unfinished)" : "FINISHED orders only (ready or cancelled)"}`,
  );
  console.log("Deletes ONLY photos — orders, lines, money and status history are never touched.");

  const rows = await prisma.serviceEvidence.findMany({
    where: {
      createdAt: { lt: cutoff },
      ...(includeUnfinished
        ? {}
        : {
            service: {
              OR: [{ readyAt: { not: null } }, { cancelledAt: { not: null } }],
            },
          }),
    },
    select: { id: true, r2Key: true, serviceId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const [first, ...rest] = rows;
  if (!first) {
    console.log("\nResult: NOTHING TO PURGE — no evidence older than the cutoff.");
    return 0;
  }

  printReport([first, ...rest]);

  if (!fix) {
    console.log(`\nResult: ${rows.length} photo(s) would be purged. Re-run with --fix to apply.`);
    return 1;
  }

  // Rows FIRST (one transaction, re-verified), objects after the commit — the products delete
  // policy: a failed object delete leaves a sweepable orphan, never a row pointing at nothing.
  const freedKeys = await deleteRows(prisma, rows, cutoff, includeUnfinished);
  console.log(`\nDB: deleted ${freedKeys.length}/${rows.length} service_evidence rows.`);

  const errors: string[] = [];
  const s3 = new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY"),
      secretAccessKey: requireEnv("R2_SECRET_KEY"),
    },
  });
  const deletedObjects = await deleteObjects(s3, bucket, freedKeys, errors);

  console.log("\n── Summary ─────────────────────────────────────────────────────");
  console.log(`  Photos matched:   ${rows.length}`);
  console.log(`  Rows deleted:     ${freedKeys.length}`);
  console.log(`  Objects deleted:  ${deletedObjects}`);
  console.log(`  Errors:           ${errors.length}`);

  if (errors.length > 0) {
    console.error("Result: COMPLETED WITH ERRORS — the rows are gone; re-run a sweep for the objects.");
    return 2;
  }
  console.log("Result: PURGED — storage freed, order history intact.");
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error("Purge FAILED (nothing may have been applied):", error);
    process.exit(2);
  });
