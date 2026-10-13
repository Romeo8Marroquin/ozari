// =============================================================================
// Ozari — count or empty ONE R2 bucket, so it can be deleted (R2 refuses to delete a bucket that
// still holds objects, and the Cloudflare API has no "empty bucket" call).
//
// Called by retire.ps1; not meant to be run by hand. Inputs arrive as ENVIRONMENT variables, never
// as arguments (another process can read a command line):
//
//   OZ_R2_ENDPOINT    https://<account_id>.r2.cloudflarestorage.com
//   OZ_R2_ACCESS_KEY  an R2 key pair with write access to the bucket
//   OZ_R2_SECRET_KEY
//   OZ_R2_BUCKET      the bucket
//
//   node r2-empty.mjs count   prints the number of objects (and unfinished uploads)
//   node r2-empty.mjs empty   deletes every object and aborts every unfinished multipart upload
//
// Uses the S3 client the API already depends on, configured exactly as the API configures it
// (src/helpers/storage.ts), so there is nothing to install. Prints counts only, never a key.
// =============================================================================

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiPackageJson = path.resolve(here, '..', '..', 'ozari-api', 'package.json');

let s3;
try {
  s3 = createRequire(apiPackageJson)('@aws-sdk/client-s3');
} catch {
  console.error('Cannot load @aws-sdk/client-s3 from ozari-api. Run `pnpm install` inside ozari-api first.');
  process.exit(2);
}

const mode = process.argv[2];
const { OZ_R2_ENDPOINT: endpoint, OZ_R2_ACCESS_KEY: accessKeyId, OZ_R2_SECRET_KEY: secretAccessKey, OZ_R2_BUCKET: bucket } =
  process.env;

if (!['count', 'empty'].includes(mode) || !endpoint || !accessKeyId || !secretAccessKey || !bucket) {
  console.error('usage: OZ_R2_* set; node r2-empty.mjs count|empty');
  process.exit(2);
}

const client = new s3.S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });

async function* allKeys() {
  let token;
  do {
    const page = await client.send(new s3.ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const o of page.Contents ?? []) yield o.Key;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

async function unfinishedUploads() {
  const out = [];
  let keyMarker;
  let uploadIdMarker;
  do {
    const page = await client.send(
      new s3.ListMultipartUploadsCommand({ Bucket: bucket, KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker }),
    );
    for (const u of page.Uploads ?? []) out.push({ Key: u.Key, UploadId: u.UploadId });
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
  } while (keyMarker);
  return out;
}

async function deleteBatch(keys) {
  try {
    const res = await client.send(
      new s3.DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
    );
    if (res.Errors?.length) throw new Error(`${res.Errors.length} object(s) refused`);
  } catch {
    // One at a time as the fallback: slower, but needs no batch-checksum support from the endpoint.
    for (const Key of keys) await client.send(new s3.DeleteObjectCommand({ Bucket: bucket, Key }));
  }
}

try {
  if (mode === 'count') {
    let objects = 0;
    for await (const _ of allKeys()) objects += 1;
    const uploads = (await unfinishedUploads()).length;
    console.log(`${objects} object(s), ${uploads} unfinished upload(s)`);
  } else {
    // List everything FIRST, then delete: deleting while paging can invalidate the continuation token.
    const keys = [];
    for await (const key of allKeys()) keys.push(key);
    for (let i = 0; i < keys.length; i += 1000) await deleteBatch(keys.slice(i, i + 1000));
    const deleted = keys.length;
    const uploads = await unfinishedUploads();
    for (const u of uploads) {
      await client.send(new s3.AbortMultipartUploadCommand({ Bucket: bucket, Key: u.Key, UploadId: u.UploadId }));
    }
    console.log(`deleted ${deleted} object(s), aborted ${uploads.length} unfinished upload(s)`);
  }
} catch (err) {
  // The SDK's message names the operation and the S3 error code; it never contains the credentials.
  console.error(`R2 ${mode} failed: ${err?.name ?? 'Error'}: ${err?.message ?? err}`);
  process.exit(1);
}
