/* eslint-disable no-console -- local ops script: the console report IS its product */
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getPrismaClient } from "../src/services/prisma.service.js";

/**
 * R2 ↔ DB orphan reconcile (EPIC-1 §5) — a LOCAL developer/ops script, never deployed (it lives
 * outside `src/`, so neither `tsc --project tsconfig.build.json` nor the Docker runner image ever
 * include it). English-only output on purpose: local telemetry, not user-facing copy.
 *
 * The presigned-upload design accepts one residual: files are PUT to R2 BEFORE a create/update
 * references them, so an abandoned tab or a failed save can leave objects with no row. The inverse
 * (a row pointing at a missing object) should never happen — it would mean a broken product image.
 * This script diffs the bucket's `products/` prefix against `product_images.r2_key` and reports —
 * or, with `--fix`, repairs — BOTH kinds of orphan.
 *
 * Usage (from `ozari-api/`, reads `.env` for DATABASE_URL + the R2_* vars — a DIRECT database URL
 * with enough permissions is fine; nothing here needs the pooled runtime URL):
 *
 *   pnpm reconcile:images                       # REPORT ONLY (dry run — the default)
 *   pnpm reconcile:images -- --fix              # apply: delete aged orphan objects + broken rows
 *   pnpm reconcile:images -- --grace-hours=48   # widen the in-flight-upload grace window
 *
 * Safety rules:
 *  - An unreferenced object younger than the grace window (default 24h) is NEVER deleted — it may
 *    be an upload whose create/update is literally in progress. It is reported as "skipped".
 *  - DB fixes run in ONE transaction and RE-VERIFY each row inside it (same id, same key, still
 *    unreferenced) — a row that changed since the scan is left alone and reported.
 *  - R2 deletions are batched (DeleteObjects, ≤1000/batch) and every per-key failure is reported.
 *
 * Exit codes: 0 = clean (or all fixes applied cleanly) · 1 = dry run found discrepancies ·
 * 2 = an error occurred (env, query, transaction, or any per-key R2 failure).
 */

const PREFIX = "products/";
const DEFAULT_GRACE_HOURS = 24;
const R2_DELETE_BATCH = 1000;

interface RemoteObject {
  key: string;
  lastModified: Date | undefined;
  size: number;
}

interface Summary {
  dbRows: number;
  remoteObjects: number;
  orphanObjects: RemoteObject[];
  skippedInGrace: RemoteObject[];
  brokenRows: { id: number; productId: number; r2Key: string; isPrimary: boolean }[];
  deletedObjects: number;
  deletedRows: number;
  errors: string[];
}

function parseArgs(argv: string[]): { fix: boolean; graceHours: number } {
  const fix = argv.includes("--fix");
  const graceArg = argv.find((arg) => arg.startsWith("--grace-hours="));
  const graceHours = graceArg ? Number(graceArg.split("=")[1]) : DEFAULT_GRACE_HOURS;
  if (!Number.isFinite(graceHours) || graceHours < 0) {
    throw new Error(`Invalid --grace-hours value: ${graceArg}`);
  }
  return { fix, graceHours };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (run from ozari-api/ with a filled .env)`);
  }
  return value;
}

async function listRemoteObjects(client: S3Client, bucket: string): Promise<RemoteObject[]> {
  const objects: RemoteObject[] = [];
  let continuationToken: string | undefined;
  do {
    // eslint-disable-next-line no-await-in-loop -- ListObjectsV2 pagination is inherently sequential
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: PREFIX,
        ...(continuationToken && { ContinuationToken: continuationToken }),
      }),
    );
    for (const item of page.Contents ?? []) {
      if (item.Key) {
        objects.push({ key: item.Key, lastModified: item.LastModified, size: item.Size ?? 0 });
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

function formatAge(lastModified: Date | undefined, now: number): string {
  if (!lastModified) {return "age unknown";}
  const hours = (now - lastModified.getTime()) / 3_600_000;
  return hours >= 48 ? `${(hours / 24).toFixed(1)}d old` : `${hours.toFixed(1)}h old`;
}

function printReport(summary: Summary, graceHours: number, now: number): void {
  if (summary.orphanObjects.length > 0) {
    console.log(`\nOrphan OBJECTS (no DB row, past grace) — ${summary.orphanObjects.length}:`);
    for (const object of summary.orphanObjects) {
      console.log(`  - ${object.key}  (${formatAge(object.lastModified, now)}, ${object.size} bytes)`);
    }
  }
  if (summary.skippedInGrace.length > 0) {
    console.log(
      `\nUnreferenced objects WITHIN the ${graceHours}h grace window (possibly in-flight uploads) — ` +
        `${summary.skippedInGrace.length} (never touched):`,
    );
    for (const object of summary.skippedInGrace) {
      console.log(`  - ${object.key}  (${formatAge(object.lastModified, now)})`);
    }
  }
  if (summary.brokenRows.length > 0) {
    console.log(`\nBroken ROWS (DB row, object missing in R2) — ${summary.brokenRows.length}:`);
    for (const row of summary.brokenRows) {
      console.log(
        `  - row ${row.id} → product ${row.productId} (${row.isPrimary ? "PRIMARY — " : ""}key ${row.r2Key})`,
      );
    }
  }
}

/** Delete the broken rows in ONE transaction, RE-VERIFYING each inside it (same id AND the same
 *  still-missing key) — a row that changed since the scan is skipped and reported. */
async function fixBrokenRows(
  prisma: Awaited<ReturnType<typeof getPrismaClient>>,
  summary: Summary,
  remoteKeys: ReadonlySet<string>,
): Promise<void> {
  if (summary.brokenRows.length === 0) {
    return;
  }
  const brokenIds = summary.brokenRows.map((row) => row.id);
  const deletedRows = await prisma.$transaction(async (tx) => {
    const current = await tx.productImage.findMany({
      where: { id: { in: brokenIds } },
      select: { id: true, r2Key: true },
    });
    const confirmed = current.filter((row) => !remoteKeys.has(row.r2Key)).map((row) => row.id);
    for (const id of brokenIds.filter((candidate) => !confirmed.includes(candidate))) {
      console.log(`  ! row ${id} changed since the scan — SKIPPED (re-run to re-evaluate)`);
    }
    if (confirmed.length === 0) {
      return 0;
    }
    const result = await tx.productImage.deleteMany({ where: { id: { in: confirmed } } });
    return result.count;
  });
  summary.deletedRows = deletedRows;
  console.log(
    `\nDB fix: deleted ${deletedRows}/${summary.brokenRows.length} broken rows (transaction committed).`,
  );
  const primaries = summary.brokenRows.filter((row) => row.isPrimary);
  if (primaries.length > 0) {
    console.log(
      `  ! ${primaries.length} deleted row(s) were PRIMARY — the affected product(s) now lead with ` +
        `their first remaining photo: ${primaries.map((row) => row.productId).join(", ")}`,
    );
  }
}

/** Delete aged orphan objects in ≤1000-key batches, logging every per-key failure. */
async function deleteOrphanObjects(s3: S3Client, bucket: string, summary: Summary): Promise<void> {
  for (let start = 0; start < summary.orphanObjects.length; start += R2_DELETE_BATCH) {
    const batch = summary.orphanObjects.slice(start, start + R2_DELETE_BATCH);
    // eslint-disable-next-line no-await-in-loop -- batches run sequentially on purpose (clear logs, gentle on R2)
    const response = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((object) => ({ Key: object.key })), Quiet: false },
      }),
    );
    summary.deletedObjects += response.Deleted?.length ?? 0;
    for (const failure of response.Errors ?? []) {
      const message = `R2 delete failed for ${failure.Key}: ${failure.Code} ${failure.Message}`;
      summary.errors.push(message);
      console.error(`  ! ${message}`);
    }
  }
  if (summary.orphanObjects.length > 0) {
    console.log(
      `R2 fix: deleted ${summary.deletedObjects}/${summary.orphanObjects.length} orphan objects.`,
    );
  }
}

async function main(): Promise<number> {
  const { fix, graceHours } = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const graceCutoff = now - graceHours * 3_600_000;

  console.log("── R2 ↔ DB product-image reconcile ─────────────────────────────");
  console.log(`Mode: ${fix ? "FIX (will delete)" : "REPORT ONLY (dry run — pass --fix to apply)"}`);
  console.log(`Grace window: ${graceHours}h (younger unreferenced objects are never touched)`);

  requireEnv("DATABASE_URL");
  const bucket = requireEnv("R2_BUCKET_NAME");
  const s3 = new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY"),
      secretAccessKey: requireEnv("R2_SECRET_KEY"),
    },
  });
  const prisma = await getPrismaClient();

  const summary: Summary = {
    dbRows: 0,
    remoteObjects: 0,
    orphanObjects: [],
    skippedInGrace: [],
    brokenRows: [],
    deletedObjects: 0,
    deletedRows: 0,
    errors: [],
  };

  // ── Scan both sides ────────────────────────────────────────────────────────
  const rows = await prisma.productImage.findMany({
    select: { id: true, r2Key: true, productId: true, isPrimary: true },
  });
  summary.dbRows = rows.length;
  console.log(`DB: ${rows.length} product_images rows`);

  const objects = await listRemoteObjects(s3, bucket);
  summary.remoteObjects = objects.length;
  console.log(`R2: ${objects.length} objects under "${PREFIX}"`);

  const dbKeys = new Set(rows.map((row) => row.r2Key));
  const remoteKeys = new Set(objects.map((object) => object.key));

  // Objects with no row → orphan files (deletable once past the grace window).
  for (const object of objects) {
    if (dbKeys.has(object.key)) {continue;}
    const pastGrace = object.lastModified !== undefined && object.lastModified.getTime() <= graceCutoff;
    (pastGrace ? summary.orphanObjects : summary.skippedInGrace).push(object);
  }

  // Rows with no object → broken images (the product renders a dead URL).
  summary.brokenRows = rows.filter((row) => !remoteKeys.has(row.r2Key));

  printReport(summary, graceHours, now);

  const findings = summary.orphanObjects.length + summary.brokenRows.length;
  if (findings === 0) {
    console.log("\nResult: CLEAN — every object has a row and every row has an object.");
    return 0;
  }

  if (!fix) {
    console.log(`\nResult: ${findings} discrepancies found. Re-run with --fix to repair.`);
    return 1;
  }

  // ── Fix: DB first (one transaction, re-verified), then R2 (batched) ──────────
  await fixBrokenRows(prisma, summary, remoteKeys);
  await deleteOrphanObjects(s3, bucket, summary);

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log("\n── Summary ─────────────────────────────────────────────────────");
  console.log(`  DB rows scanned:        ${summary.dbRows}`);
  console.log(`  R2 objects scanned:     ${summary.remoteObjects}`);
  console.log(`  Orphan objects deleted: ${summary.deletedObjects}`);
  console.log(`  Broken rows deleted:    ${summary.deletedRows}`);
  console.log(`  Skipped (grace window): ${summary.skippedInGrace.length}`);
  console.log(`  Errors:                 ${summary.errors.length}`);

  if (summary.errors.length > 0) {
    console.error("Result: COMPLETED WITH ERRORS — see the failures above and re-run.");
    return 2;
  }
  console.log("Result: FIXED — re-run without --fix to verify a clean diff.");
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error("Reconcile FAILED (nothing may have been applied):", error);
    process.exit(2);
  });
