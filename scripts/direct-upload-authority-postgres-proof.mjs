#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "DIRECT_UPLOAD_AUTHORITY_PROOF_DATABASE_URL";
const PREFIX = "direct-upload-authority-proof";
const RUNTIME_ROLE = "grainline_app_runtime";
const ids = Object.freeze({
  owner: `${PREFIX}-owner`,
  outsider: `${PREFIX}-outsider`,
  ownerSeller: `${PREFIX}-owner-seller`,
  listingA: `${PREFIX}-listing-a`,
  listingB: `${PREFIX}-listing-b`,
  photoA: `${PREFIX}-photo-a`,
  photoB: `${PREFIX}-photo-b`,
  legacyPhoto: `${PREFIX}-legacy-photo`,
  broadcast: `${PREFIX}-broadcast`,
});
const actorSegments = Object.freeze({
  owner: "clerk-direct-upload-authority-proof-owner",
  outsider: "clerk-direct-upload-authority-proof-outsider",
});
const uploads = Object.freeze({
  a: {
    key: `listingImage/${actorSegments.owner}/a.webp`,
    url: `https://proof.invalid/listingImage/${actorSegments.owner}/a.webp`,
  },
  b: {
    key: `listingImage/${actorSegments.owner}/b.webp`,
    url: `https://proof.invalid/listingImage/${actorSegments.owner}/b.webp`,
  },
});
const legacyUrl = "https://legacy.invalid/direct-upload-authority-proof.webp";

const runtimeFunctions = Object.freeze([
  "grainline_direct_upload_record_processed_public",
  "grainline_direct_upload_record_presigned_public",
  "grainline_direct_upload_record_private_case",
  "grainline_direct_upload_record_private_message",
  "grainline_direct_upload_verify_public",
  "grainline_direct_upload_owned_lookup",
  "grainline_direct_upload_reference_case_attachment",
  "grainline_direct_upload_case_attachment_read",
  "grainline_direct_upload_cleanup_lease",
  "grainline_direct_upload_cleanup_complete",
  "grainline_direct_upload_cleanup_fail",
  "grainline_direct_upload_export",
  "grainline_direct_upload_account_public_urls",
  "grainline_direct_upload_release_for_account",
  "grainline_direct_upload_sync_listing",
  "grainline_direct_upload_sync_seller_profile",
  "grainline_direct_upload_sync_review",
  "grainline_direct_upload_sync_blog_post",
  "grainline_direct_upload_sync_commission_request",
  "grainline_direct_upload_sync_seller_broadcast",
  "grainline_direct_upload_sync_legacy_message",
]);

const privateFunctions = Object.freeze([
  "grainline_direct_upload_actor_valid",
  "grainline_direct_upload_utc_now",
  "grainline_direct_upload_record_core",
  "grainline_direct_upload_reference_core",
  "grainline_direct_upload_release_core",
  "grainline_direct_upload_sync_public_core",
  "grainline_direct_upload_message_url_core",
  "grainline_direct_upload_release_source_core",
  "grainline_direct_upload_source_delete_trigger",
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

function applicationUrl(databaseUrl, applicationName) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set("application_name", applicationName);
  return parsed.toString();
}

async function connect(databaseUrl, applicationName, runtime = false) {
  const client = new Client({
    connectionString: applicationUrl(databaseUrl, applicationName),
  });
  await client.connect();
  if (runtime) {
    await client.query(`SET ROLE ${RUNTIME_ROLE}`);
  }
  return client;
}

export function parseProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "DirectUpload authority proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `DirectUpload authority proof requires the ${DATABASE_NAME} database`,
  );
  return { databaseUrl };
}

async function expectSqlState(action, expectedState, label) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, expectedState, `${label} returned the wrong SQLSTATE`);
}

async function waitForLock(observer, applicationName) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `
        SELECT wait_event_type, wait_event
          FROM pg_catalog.pg_stat_activity
         WHERE application_name = $1
           AND pid <> pg_catalog.pg_backend_pid()
           AND state <> 'idle'
         ORDER BY backend_start DESC
         LIMIT 1
      `,
      [applicationName],
    );
    if (result.rows[0]?.wait_event_type === "Lock") {
      return result.rows[0].wait_event;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${applicationName} did not enter a PostgreSQL lock wait`);
}

async function cleanupFixtures(owner) {
  await owner.query(
    `DELETE FROM public."Photo" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(
    `DELETE FROM public."SellerBroadcast" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(
    `DELETE FROM public."Listing" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(
    `
      DELETE FROM public."DirectUploadReference"
       WHERE "sourceId" LIKE '${PREFIX}-%'
          OR "directUploadId" IN (
            SELECT id
              FROM public."DirectUpload"
             WHERE "userId" IN ($1, $2)
          )
    `,
    [ids.owner, ids.outsider],
  );
  await owner.query(
    `DELETE FROM public."DirectUpload" WHERE "userId" IN ($1, $2)`,
    [ids.owner, ids.outsider],
  );
  await owner.query(
    `DELETE FROM public."SellerProfile" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(
    `DELETE FROM public."User" WHERE id IN ($1, $2)`,
    [ids.owner, ids.outsider],
  );
}

async function seedFixtures(owner) {
  await cleanupFixtures(owner);
  await owner.query(
    `
      INSERT INTO public."User" (
        id, "clerkId", email, name, role, banned, "createdAt", "updatedAt"
      )
      VALUES
        ($1, $2, $3, 'DirectUpload Proof Owner', 'USER', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ($4, $5, $6, 'DirectUpload Proof Outsider', 'USER', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [
      ids.owner,
      actorSegments.owner,
      `${PREFIX}-owner@example.invalid`,
      ids.outsider,
      actorSegments.outsider,
      `${PREFIX}-outsider@example.invalid`,
    ],
  );
  await owner.query(
    `
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized",
        "createdAt", "updatedAt"
      )
      VALUES ($1, $2, 'DirectUpload Proof Seller',
              'directupload proof seller', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [ids.ownerSeller, ids.owner],
  );
  await owner.query(
    `
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents",
        "listingType", "stockQuantity", "createdAt", "updatedAt"
      )
      VALUES
        ($1, $3, 'DirectUpload proof listing A', 'Disposable proof fixture.',
         1000, 'IN_STOCK', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ($2, $3, 'DirectUpload proof listing B', 'Disposable proof fixture.',
         1000, 'IN_STOCK', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [ids.listingA, ids.listingB, ids.ownerSeller],
  );
}

async function catalogProof(owner) {
  const role = await owner.query(
    `
      SELECT rolsuper, rolinherit, rolcanlogin, rolreplication, rolbypassrls
        FROM pg_catalog.pg_roles
       WHERE rolname = $1
    `,
    [RUNTIME_ROLE],
  );
  assert.deepEqual(role.rows, [
    {
      rolsuper: false,
      rolinherit: false,
      rolcanlogin: true,
      rolreplication: false,
      rolbypassrls: false,
    },
  ]);

  const tables = await owner.query(`
    SELECT class.relname, class.relrowsecurity, class.relforcerowsecurity,
           pg_catalog.has_table_privilege(
             '${RUNTIME_ROLE}', class.oid, 'SELECT,INSERT,UPDATE,DELETE'
           ) AS runtime_crud
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('DirectUpload', 'DirectUploadReference')
     ORDER BY class.relname
  `);
  assert.deepEqual(tables.rows, [
    {
      relname: "DirectUpload",
      relrowsecurity: false,
      relforcerowsecurity: false,
      runtime_crud: true,
    },
    {
      relname: "DirectUploadReference",
      relrowsecurity: true,
      relforcerowsecurity: true,
      runtime_crud: false,
    },
  ]);

  const functions = await owner.query(
    `
      SELECT procedure.proname,
             procedure.prosecdef,
             procedure.proconfig,
             pg_catalog.has_function_privilege(
               $1,
               procedure.oid,
               'EXECUTE'
             ) AS runtime_execute,
             EXISTS (
               SELECT 1
                 FROM pg_catalog.aclexplode(
                   COALESCE(
                     procedure.proacl,
                     pg_catalog.acldefault('f', procedure.proowner)
                   )
                 ) AS acl
                WHERE acl.grantee = 0
                  AND acl.privilege_type = 'EXECUTE'
             ) AS public_execute
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = ANY ($2::text[])
       ORDER BY procedure.proname
    `,
    [RUNTIME_ROLE, [...runtimeFunctions, ...privateFunctions]],
  );
  assert.equal(functions.rows.length, runtimeFunctions.length + privateFunctions.length);
  for (const row of functions.rows) {
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
    assert.equal(row.public_execute, false, `${row.proname} is executable by PUBLIC`);
    assert.equal(
      row.runtime_execute,
      runtimeFunctions.includes(row.proname),
      `${row.proname} has the wrong runtime EXECUTE posture`,
    );
    if (!["grainline_direct_upload_utc_now", "grainline_direct_upload_message_url_core"].includes(row.proname)) {
      assert.equal(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
    }
  }

  const triggers = await owner.query(`
    SELECT class.relname, trigger.tgname
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS class ON class.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND trigger.tgname LIKE 'grainline_direct_upload_release_%_delete'
       AND NOT trigger.tgisinternal
     ORDER BY class.relname
  `);
  assert.deepEqual(triggers.rows, [
    { relname: "BlogPost", tgname: "grainline_direct_upload_release_blog_post_delete" },
    { relname: "CommissionRequest", tgname: "grainline_direct_upload_release_commission_request_delete" },
    { relname: "Listing", tgname: "grainline_direct_upload_release_listing_delete" },
    { relname: "Message", tgname: "grainline_direct_upload_release_legacy_message_delete" },
    { relname: "Review", tgname: "grainline_direct_upload_release_review_delete" },
    { relname: "SellerBroadcast", tgname: "grainline_direct_upload_release_seller_broadcast_delete" },
    { relname: "SellerProfile", tgname: "grainline_direct_upload_release_seller_profile_delete" },
  ]);
}

async function recordUpload(runtime, upload) {
  const result = await runtime.query(
    `
      SELECT public.grainline_direct_upload_record_processed_public(
        $1, $2, 'listingImage', $3, 'image/webp', 1024
      ) AS id
    `,
    [ids.owner, upload.key, upload.url],
  );
  assert.equal(typeof result.rows[0]?.id, "string");
  return result.rows[0].id;
}

async function syncListing(runtime, listingId) {
  const result = await runtime.query(
    `
      SELECT referenced, released, untracked
        FROM public.grainline_direct_upload_sync_listing($1, $2)
    `,
    [ids.owner, listingId],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function syncBroadcast(runtime) {
  const result = await runtime.query(
    `
      SELECT referenced, released, untracked
        FROM public.grainline_direct_upload_sync_seller_broadcast($1, $2)
    `,
    [ids.owner, ids.broadcast],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function activeReferenceCount(owner, uploadId) {
  const result = await owner.query(
    `
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."DirectUploadReference"
       WHERE "directUploadId" = $1
         AND "releasedAt" IS NULL
    `,
    [uploadId],
  );
  return result.rows[0].count;
}

async function authorityProof(owner, runtime) {
  await expectSqlState(
    () => runtime.query(`SELECT * FROM public."DirectUploadReference" LIMIT 1`),
    "42501",
    "runtime DirectUploadReference SELECT",
  );
  await expectSqlState(
    () =>
      runtime.query(
        `
          SELECT public.grainline_direct_upload_sync_public_core(
            $1, 'LISTING_PHOTO', $2, ARRAY['listingImage']::text[], ARRAY[]::text[]
          )
        `,
        [ids.owner, ids.listingA],
      ),
    "42501",
    "runtime generic source sync",
  );
  await expectSqlState(
    () =>
      runtime.query(
        `
          SELECT public.grainline_direct_upload_record_processed_public(
            NULL, $1, 'listingImage', $2, 'image/webp', 1024
          )
        `,
        [uploads.a.key, uploads.a.url],
      ),
    "42501",
    "NULL DirectUpload actor",
  );
  await expectSqlState(
    () =>
      runtime.query(
        `
          SELECT public.grainline_direct_upload_record_processed_public(
            $1, $2, 'listingImage', $3, 'image/webp', 1024
          )
        `,
        [
          ids.owner,
          `listingImage/${actorSegments.outsider}/forged.webp`,
          `https://proof.invalid/listingImage/${actorSegments.outsider}/forged.webp`,
        ],
      ),
    "42501",
    "forged DirectUpload actor key segment",
  );

  const uploadA = await recordUpload(runtime, uploads.a);
  const uploadB = await recordUpload(runtime, uploads.b);
  await owner.query(
    `
      INSERT INTO public."Photo" (
        id, "listingId", url, "originalUrl", "sortOrder", "createdAt"
      )
      VALUES
        ($1, $3, $5, $5, 0, CURRENT_TIMESTAMP),
        ($2, $4, $6, $6, 0, CURRENT_TIMESTAMP)
    `,
    [ids.photoA, ids.photoB, ids.listingA, ids.listingB, uploads.a.url, uploads.b.url],
  );

  await expectSqlState(
    () =>
      runtime.query(
        `SELECT * FROM public.grainline_direct_upload_sync_listing($1, $2)`,
        [ids.outsider, ids.listingA],
      ),
    "42501",
    "foreign Listing fixed sync",
  );
  assert.deepEqual(await syncListing(runtime, ids.listingA), {
    referenced: 1,
    released: 0,
    untracked: 0,
  });
  assert.deepEqual(await syncListing(runtime, ids.listingB), {
    referenced: 1,
    released: 0,
    untracked: 0,
  });

  await owner.query(
    `UPDATE public."Photo" SET url = $2, "originalUrl" = $2 WHERE id = $1`,
    [ids.photoA, uploads.b.url],
  );
  await owner.query(
    `
      INSERT INTO public."Photo" (
        id, "listingId", url, "originalUrl", "sortOrder", "createdAt"
      )
      VALUES ($1, $2, $3, $3, 1, CURRENT_TIMESTAMP)
    `,
    [ids.legacyPhoto, ids.listingA, legacyUrl],
  );
  assert.deepEqual(await syncListing(runtime, ids.listingA), {
    referenced: 1,
    released: 0,
    untracked: 1,
  });
  assert.equal(await activeReferenceCount(owner, uploadA), 1);
  assert.equal(await activeReferenceCount(owner, uploadB), 2);

  await owner.query(`DELETE FROM public."Photo" WHERE id = $1`, [ids.legacyPhoto]);
  assert.deepEqual(await syncListing(runtime, ids.listingA), {
    referenced: 1,
    released: 1,
    untracked: 0,
  });
  await owner.query(
    `UPDATE public."Photo" SET url = $2, "originalUrl" = $2 WHERE id = $1`,
    [ids.photoA, uploads.a.url],
  );
  assert.deepEqual(await syncListing(runtime, ids.listingA), {
    referenced: 1,
    released: 1,
    untracked: 0,
  });

  return { uploadA, uploadB };
}

async function swapConcurrencyProof(databaseUrl, observer) {
  const first = await connect(databaseUrl, `${PREFIX}-swap-first`, true);
  const second = await connect(databaseUrl, `${PREFIX}-swap-second`, true);
  try {
    await first.query("BEGIN");
    await first.query(
      `UPDATE public."Photo" SET url = $2, "originalUrl" = $2 WHERE id = $1`,
      [ids.photoA, uploads.b.url],
    );
    assert.deepEqual(await syncListing(first, ids.listingA), {
      referenced: 1,
      released: 1,
      untracked: 0,
    });

    await second.query("BEGIN");
    await second.query(
      `UPDATE public."Photo" SET url = $2, "originalUrl" = $2 WHERE id = $1`,
      [ids.photoB, uploads.a.url],
    );
    const waitingSync = syncListing(second, ids.listingB);
    const waitEvent = await waitForLock(observer, `${PREFIX}-swap-second`);
    assert.ok(waitEvent);
    await first.query("COMMIT");
    assert.deepEqual(await waitingSync, {
      referenced: 1,
      released: 1,
      untracked: 0,
    });
    await second.query("COMMIT");
  } catch (error) {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await first.end();
    await second.end();
  }
}

async function sourceReuseProof(owner, runtime, uploadA) {
  await owner.query(
    `
      INSERT INTO public."SellerBroadcast" (
        id, "sellerProfileId", message, "imageUrl", "sentAt", "recipientCount"
      )
      VALUES ($1, $2, 'Disposable DirectUpload proof broadcast', $3, CURRENT_TIMESTAMP, 0)
    `,
    [ids.broadcast, ids.ownerSeller, uploads.a.url],
  );
  assert.deepEqual(await syncBroadcast(runtime), {
    referenced: 1,
    released: 0,
    untracked: 0,
  });
  assert.equal(await activeReferenceCount(owner, uploadA), 2);

  await owner.query(`DELETE FROM public."Photo" WHERE id = $1`, [ids.photoB]);
  await owner.query(`DELETE FROM public."Listing" WHERE id = $1`, [ids.listingB]);
  assert.equal(await activeReferenceCount(owner, uploadA), 1);
  assert.equal(
    (await owner.query(`SELECT status FROM public."DirectUpload" WHERE id = $1`, [uploadA]))
      .rows[0].status,
    "CLAIMED",
  );

  await owner.query(`DELETE FROM public."SellerBroadcast" WHERE id = $1`, [ids.broadcast]);
  assert.equal(await activeReferenceCount(owner, uploadA), 0);
  const released = await owner.query(
    `SELECT status, "cleanupAfter" IS NOT NULL AS cleanup_ready FROM public."DirectUpload" WHERE id = $1`,
    [uploadA],
  );
  assert.deepEqual(released.rows, [{ status: "VERIFIED", cleanup_ready: true }]);
}

async function cleanupConcurrencyProof(databaseUrl, observer, owner, runtime, uploadA) {
  await owner.query(
    `
      INSERT INTO public."SellerBroadcast" (
        id, "sellerProfileId", message, "imageUrl", "sentAt", "recipientCount"
      )
      VALUES ($1, $2, 'Disposable DirectUpload cleanup proof', $3, CURRENT_TIMESTAMP, 0)
    `,
    [ids.broadcast, ids.ownerSeller, uploads.a.url],
  );
  await owner.query(
    `UPDATE public."DirectUpload" SET "cleanupAfter" = CURRENT_TIMESTAMP - interval '1 minute' WHERE id = $1`,
    [uploadA],
  );

  const referenceFirst = await connect(
    databaseUrl,
    `${PREFIX}-reference-first`,
    true,
  );
  const cleanupSecond = await connect(
    databaseUrl,
    `${PREFIX}-cleanup-second`,
    true,
  );
  try {
    await referenceFirst.query("BEGIN");
    assert.deepEqual(await syncBroadcast(referenceFirst), {
      referenced: 1,
      released: 0,
      untracked: 0,
    });
    const skippedLease = await cleanupSecond.query(
      `SELECT * FROM public.grainline_direct_upload_cleanup_lease(20)`,
    );
    assert.deepEqual(skippedLease.rows, []);
    await referenceFirst.query("COMMIT");
  } catch (error) {
    await referenceFirst.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await referenceFirst.end();
    await cleanupSecond.end();
  }

  await owner.query(`UPDATE public."SellerBroadcast" SET "imageUrl" = NULL WHERE id = $1`, [
    ids.broadcast,
  ]);
  assert.deepEqual(await syncBroadcast(runtime), {
    referenced: 0,
    released: 1,
    untracked: 0,
  });
  await owner.query(
    `UPDATE public."DirectUpload" SET "cleanupAfter" = CURRENT_TIMESTAMP - interval '1 minute' WHERE id = $1`,
    [uploadA],
  );

  const cleanupFirst = await connect(
    databaseUrl,
    `${PREFIX}-cleanup-first`,
    true,
  );
  const referenceSecond = await connect(
    databaseUrl,
    `${PREFIX}-reference-second`,
    true,
  );
  let lease;
  try {
    await cleanupFirst.query("BEGIN");
    const leased = await cleanupFirst.query(
      `SELECT * FROM public.grainline_direct_upload_cleanup_lease(20)`,
    );
    lease = leased.rows.find((row) => row.id === uploadA);
    assert.ok(lease, "cleanup-first did not lease the expected upload");

    await referenceSecond.query("BEGIN");
    await referenceSecond.query(
      `UPDATE public."SellerBroadcast" SET "imageUrl" = $2 WHERE id = $1`,
      [ids.broadcast, uploads.a.url],
    );
    const waitingSync = syncBroadcast(referenceSecond);
    await waitForLock(observer, `${PREFIX}-reference-second`);
    await cleanupFirst.query("COMMIT");
    assert.deepEqual(await waitingSync, {
      referenced: 0,
      released: 0,
      untracked: 1,
    });
    await referenceSecond.query("ROLLBACK");
  } catch (error) {
    await cleanupFirst.query("ROLLBACK").catch(() => {});
    await referenceSecond.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await cleanupFirst.end();
    await referenceSecond.end();
  }

  assert.equal(
    (
      await runtime.query(
        `SELECT public.grainline_direct_upload_cleanup_complete($1, $2) AS completed`,
        [uploadA, "wrong-lease"],
      )
    ).rows[0].completed,
    false,
  );
  assert.equal(
    (
      await runtime.query(
        `SELECT public.grainline_direct_upload_cleanup_complete($1, $2) AS completed`,
        [uploadA, lease.leaseId],
      )
    ).rows[0].completed,
    true,
  );
  assert.equal(
    (await owner.query(`SELECT status FROM public."DirectUpload" WHERE id = $1`, [uploadA]))
      .rows[0].status,
    "DELETED",
  );
}

export async function runProof(env = process.env) {
  const { databaseUrl } = parseProofConfig(env);
  const owner = await connect(databaseUrl, `${PREFIX}-owner`);
  const runtime = await connect(databaseUrl, `${PREFIX}-runtime`, true);
  const checks = [];
  try {
    await catalogProof(owner);
    checks.push("catalog_and_acl");
    await seedFixtures(owner);
    const { uploadA } = await authorityProof(owner, runtime);
    checks.push("fixed_authority_and_partial_source");
    await swapConcurrencyProof(databaseUrl, owner);
    checks.push("stable_swap_lock_order");
    await sourceReuseProof(owner, runtime, uploadA);
    checks.push("multi_source_reuse_and_delete_release");
    await cleanupConcurrencyProof(databaseUrl, owner, owner, runtime, uploadA);
    checks.push("reference_cleanup_winner_orderings");
    assert.equal(checks.length, 5);
    return {
      ok: true,
      database: DATABASE_NAME,
      checks,
      persistentStagingChanged: false,
      productionChanged: false,
    };
  } finally {
    await cleanupFixtures(owner).catch(() => {});
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

async function main() {
  try {
    const result = await runProof();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload authority PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
