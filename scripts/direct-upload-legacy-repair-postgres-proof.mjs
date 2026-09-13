#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "DIRECT_UPLOAD_LEGACY_REPAIR_PROOF_DATABASE_URL";
const PREFIX = "direct-upload-legacy-repair-proof";
const MIGRATION_PATH =
  "prisma/migrations/20260726185700_repair_direct_upload_legacy_references/migration.sql";
const ids = Object.freeze({
  owner: `${PREFIX}-owner`,
  seller: `${PREFIX}-seller`,
  listingA: `${PREFIX}-listing-a`,
  listingB: `${PREFIX}-listing-b`,
  photoA: `${PREFIX}-photo-a`,
  photoB: `${PREFIX}-photo-b`,
  uploadA: `${PREFIX}-upload-a`,
  uploadB: `${PREFIX}-upload-b`,
  uploadC: `${PREFIX}-upload-c`,
});
const actorSegment = "clerk-direct-upload-legacy-repair-proof-owner";
const uploadMetadata = Object.freeze([
  {
    id: ids.uploadA,
    key: `listingImage/${actorSegment}/a.png`,
    contentType: "image/png",
  },
  {
    id: ids.uploadB,
    key: `listingImage/${actorSegment}/b.jpg`,
    contentType: "image/jpeg",
  },
  {
    id: ids.uploadC,
    key: `listingImage/${actorSegment}/c.png`,
    contentType: "image/png",
  },
]);

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

function applicationUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set(
    "application_name",
    "grainline-direct-upload-legacy-repair-proof",
  );
  return parsed.toString();
}

export function parseProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "DirectUpload legacy repair proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `DirectUpload legacy repair proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

export function loadReviewedMigration(
  readSource = (path) => readFileSync(path, "utf8"),
) {
  const sql = readSource(MIGRATION_PATH);
  assert.match(
    sql,
    /^-- Normalize the exact prelaunch DirectUpload legacy population/m,
  );
  assert.match(
    sql,
    /pg_catalog\.pg_advisory_xact_lock\([\s\S]*grainline\.direct-upload\.rls\.activation/,
  );
  assert.match(sql, /IF upload_count <> 3 OR reference_count <> 0 THEN/);
  assert.match(
    sql,
    /IF referenced_total <> 2 OR matching_source_count <> 2 THEN/,
  );
  assert.match(sql, /repair_at \+ interval '7 days'/);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\."DirectUpload"\b/i);
  return Object.freeze({
    path: MIGRATION_PATH,
    sha256: createHash("sha256").update(sql).digest("hex"),
    sql,
  });
}

async function connect(databaseUrl) {
  const client = new Client({
    connectionString: applicationUrl(databaseUrl),
  });
  await client.connect();
  return client;
}

async function assertDisposableDatabaseIsEmpty(client) {
  const result = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*) FROM public."DirectUpload")::integer
        AS upload_count,
      (SELECT pg_catalog.count(*) FROM public."DirectUploadReference")::integer
        AS reference_count
  `);
  assert.deepEqual(result.rows[0], {
    upload_count: 0,
    reference_count: 0,
  });
}

async function cleanupFixtures(client) {
  await client.query(
    `DELETE FROM public."DirectUploadReference"
      WHERE "sourceId" LIKE $1
         OR "directUploadId" IN ($2, $3, $4)`,
    [`${PREFIX}-%`, ids.uploadA, ids.uploadB, ids.uploadC],
  );
  await client.query(
    `DELETE FROM public."Photo" WHERE id IN ($1, $2)`,
    [ids.photoA, ids.photoB],
  );
  await client.query(
    `DELETE FROM public."Listing" WHERE id IN ($1, $2)`,
    [ids.listingA, ids.listingB],
  );
  await client.query(
    `DELETE FROM public."DirectUpload" WHERE id IN ($1, $2, $3)`,
    [ids.uploadA, ids.uploadB, ids.uploadC],
  );
  await client.query(
    `DELETE FROM public."SellerProfile" WHERE id = $1`,
    [ids.seller],
  );
  await client.query(
    `DELETE FROM public."User" WHERE id = $1`,
    [ids.owner],
  );
}

function publicUrl(metadata) {
  return `https://proof.invalid/${metadata.key}`;
}

async function seedScenario(client, shape) {
  assert.ok(
    shape === "two-distinct-uploads" || shape === "one-reused-upload",
    "unknown DirectUpload legacy repair proof shape",
  );
  await assertDisposableDatabaseIsEmpty(client);

  await client.query(
    `
      INSERT INTO public."User" (
        id, "clerkId", email, name, role, banned, "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, 'DirectUpload Legacy Repair Proof', 'USER', false,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
    [
      ids.owner,
      actorSegment,
      `${PREFIX}-owner@example.invalid`,
    ],
  );
  await client.query(
    `
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, 'Repair Proof Seller', 'repair proof seller',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
    [ids.seller, ids.owner],
  );
  await client.query(
    `
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents",
        "listingType", "stockQuantity", "createdAt", "updatedAt"
      )
      VALUES
        (
          $1, $3, 'Repair proof listing A', 'Disposable proof fixture',
          1000, 'IN_STOCK', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ),
        (
          $2, $3, 'Repair proof listing B', 'Disposable proof fixture',
          1000, 'IN_STOCK', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
    `,
    [ids.listingA, ids.listingB, ids.seller],
  );

  const secondPhotoUrl =
    shape === "one-reused-upload"
      ? publicUrl(uploadMetadata[0])
      : publicUrl(uploadMetadata[1]);
  await client.query(
    `
      INSERT INTO public."Photo" (
        id, "listingId", url, "originalUrl", "sortOrder", "createdAt"
      )
      VALUES
        ($1, $3, $5, $5, 0, CURRENT_TIMESTAMP),
        ($2, $4, $6, $6, 0, CURRENT_TIMESTAMP)
    `,
    [
      ids.photoA,
      ids.photoB,
      ids.listingA,
      ids.listingB,
      publicUrl(uploadMetadata[0]),
      secondPhotoUrl,
    ],
  );

  for (const [index, metadata] of uploadMetadata.entries()) {
    await client.query(
      `
        INSERT INTO public."DirectUpload" (
          id, key, endpoint, "userId", "publicUrl", "storageClass",
          "contentType", "expectedSize", status, "cleanupAfter",
          "verifiedAt", "claimedAt", "claimedByType", "claimedById",
          attempts, "createdAt", "updatedAt"
        )
        VALUES (
          $1, $2, 'listingImage', $3, $4, 'PUBLIC',
          $5, $6, 'CLAIMED', NULL,
          CURRENT_TIMESTAMP - interval '1 day',
          CURRENT_TIMESTAMP - interval '1 day',
          'LEGACY_LISTING_IMAGE', $7,
          0, CURRENT_TIMESTAMP - interval '2 days',
          CURRENT_TIMESTAMP - interval '1 day'
        )
      `,
      [
        metadata.id,
        metadata.key,
        ids.owner,
        publicUrl(metadata),
        metadata.contentType,
        1_024 + index,
        `${PREFIX}-legacy-claim-${index}`,
      ],
    );
  }
}

async function readRepairResult(client) {
  const result = await client.query(
    `
      SELECT
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."DirectUploadReference"
           WHERE "releasedAt" IS NULL
        ) AS active_reference_count,
        (
          SELECT pg_catalog.count(DISTINCT "directUploadId")::integer
            FROM public."DirectUploadReference"
           WHERE "releasedAt" IS NULL
        ) AS referenced_upload_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."DirectUpload"
           WHERE status = 'CLAIMED'
        ) AS claimed_upload_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."DirectUpload"
           WHERE status = 'VERIFIED'
             AND "claimedAt" IS NULL
             AND "claimedByType" IS NULL
             AND "claimedById" IS NULL
             AND "cleanupAfter" >=
               public.grainline_direct_upload_utc_now() + interval '6 days'
        ) AS delayed_orphan_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."DirectUpload" AS upload
           WHERE upload.status = 'CLAIMED'
             AND upload."claimedByType" = 'LISTING_PHOTO'
             AND upload."claimedById" IN ($1, $2)
             AND upload."cleanupAfter" IS NULL
             AND EXISTS (
               SELECT 1
                 FROM public."DirectUploadReference" AS reference
                WHERE reference."directUploadId" = upload.id
                  AND reference."sourceType" = upload."claimedByType"
                  AND reference."sourceId" = upload."claimedById"
                  AND reference."releasedAt" IS NULL
             )
        ) AS normalized_claim_count
    `,
    [ids.listingA, ids.listingB],
  );
  return result.rows[0];
}

async function proveShape(client, migration, shape, expected) {
  await seedScenario(client, shape);
  await client.query(migration.sql);
  assert.deepEqual(await readRepairResult(client), expected);
  await cleanupFixtures(client);
  await assertDisposableDatabaseIsEmpty(client);
}

export async function runDirectUploadLegacyRepairProof(
  env = process.env,
  dependencies = {},
) {
  const config = parseProofConfig(env);
  const migration = loadReviewedMigration(dependencies.readSource);
  const client =
    dependencies.client ?? await connect(config.databaseUrl);
  const ownsClient = !dependencies.client;

  try {
    await assertDisposableDatabaseIsEmpty(client);
    await proveShape(
      client,
      migration,
      "two-distinct-uploads",
      {
        active_reference_count: 2,
        referenced_upload_count: 2,
        claimed_upload_count: 2,
        delayed_orphan_count: 1,
        normalized_claim_count: 2,
      },
    );
    await proveShape(
      client,
      migration,
      "one-reused-upload",
      {
        active_reference_count: 2,
        referenced_upload_count: 1,
        claimed_upload_count: 1,
        delayed_orphan_count: 2,
        normalized_claim_count: 1,
      },
    );
    return Object.freeze({
      status: "passed",
      migrationPath: migration.path,
      migrationSha256: migration.sha256,
      scenarios: Object.freeze([
        "two-distinct-uploads",
        "one-reused-upload",
      ]),
      productionChanged: false,
      persistentStagingChanged: false,
    });
  } finally {
    await cleanupFixtures(client).catch(() => {});
    if (ownsClient) await client.end().catch(() => {});
  }
}

const isMain =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runDirectUploadLegacyRepairProof()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `DirectUpload legacy repair PostgreSQL proof failed: ${safeError(error)}\n`,
      );
      process.exitCode = 1;
    });
}
