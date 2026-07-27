#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
} from "./direct-upload-activation-catalog.mjs";
import {
  directUploadFunctionSourceHashes,
} from "./direct-upload-function-source-catalog.mjs";

const { Client } = pg;
const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "DIRECT_UPLOAD_ACTIVATION_PROOF_DATABASE_URL";
const PREFIX = "direct-upload-activation-proof";
const RUNTIME_ROLE = "grainline_app_runtime";
const CLEANUP_ROLE = "grainline_direct_upload_cleanup";
const ids = Object.freeze({
  owner: `${PREFIX}-owner`,
  outsider: `${PREFIX}-outsider`,
  seller: `${PREFIX}-seller`,
  listing: `${PREFIX}-listing`,
  photo: `${PREFIX}-photo`,
  order: `${PREFIX}-order`,
  case: `${PREFIX}-case`,
  caseMessage: `${PREFIX}-case-message`,
  caseAttachment: `${PREFIX}-case-attachment`,
});
const ownerClerk = "clerk-direct-upload-activation-proof-owner";
const outsiderClerk = "clerk-direct-upload-activation-proof-outsider";
const publicKey = `listingImage/${ownerClerk}/fixture.webp`;
const publicUrl = `https://proof.invalid/${publicKey}`;
const privateKey =
  `caseEvidenceImage/${ownerClerk}/${ids.case}/fixture.webp`;

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

async function connect(databaseUrl, applicationName, role) {
  const client = new Client({
    connectionString: applicationUrl(databaseUrl, applicationName),
  });
  await client.connect();
  if (role) await client.query(`SET ROLE ${role}`);
  return client;
}

export function parseDirectUploadActivationProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "DirectUpload activation proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `DirectUpload activation proof requires ${DATABASE_NAME}`,
  );
  return Object.freeze({ databaseUrl });
}

async function expectSqlState(action, expectedState, label) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, expectedState, `${label} returned wrong SQLSTATE`);
}

async function cleanupFixtures(owner) {
  await owner.query(
    `DELETE FROM public."CaseMessageAttachment" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(
    `DELETE FROM public."CaseMessage" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(`DELETE FROM public."Case" WHERE id LIKE '${PREFIX}-%'`);
  await owner.query(`DELETE FROM public."Order" WHERE id LIKE '${PREFIX}-%'`);
  await owner.query(`DELETE FROM public."Photo" WHERE id LIKE '${PREFIX}-%'`);
  await owner.query(`DELETE FROM public."Listing" WHERE id LIKE '${PREFIX}-%'`);
  await owner.query(
    `DELETE FROM public."DirectUploadReference"
      WHERE "sourceId" LIKE '${PREFIX}-%'
         OR "directUploadId" IN (
           SELECT id FROM public."DirectUpload"
            WHERE "userId" IN ($1, $2)
         )`,
    [ids.owner, ids.outsider],
  );
  await owner.query(
    `DELETE FROM public."DirectUpload" WHERE "userId" IN ($1, $2)`,
    [ids.owner, ids.outsider],
  );
  await owner.query(
    `DELETE FROM public."SellerProfile" WHERE id = $1`,
    [ids.seller],
  );
  await owner.query(
    `DELETE FROM public."User" WHERE id IN ($1, $2)`,
    [ids.owner, ids.outsider],
  );
}

async function seedFixtures(owner) {
  await cleanupFixtures(owner);
  await owner.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, role, banned, "createdAt", "updatedAt"
     ) VALUES
       ($1, $2, $3, 'Activation Owner', 'USER', false,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ($4, $5, $6, 'Activation Outsider', 'USER', false,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      ids.owner,
      ownerClerk,
      `${PREFIX}-owner@example.invalid`,
      ids.outsider,
      outsiderClerk,
      `${PREFIX}-outsider@example.invalid`,
    ],
  );
  await owner.query(
    `INSERT INTO public."SellerProfile" (
       id, "userId", "displayName", "displayNameNormalized",
       "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 'Activation Seller', 'activation seller',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [ids.seller, ids.owner],
  );
  await owner.query(
    `INSERT INTO public."Listing" (
       id, "sellerId", title, description, "priceCents",
       "listingType", "stockQuantity", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 'Activation listing', 'Disposable fixture.',
       1000, 'IN_STOCK', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [ids.listing, ids.seller],
  );
  await owner.query(
    `INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2)`,
    [ids.order, ids.owner],
  );
  await owner.query(
    `INSERT INTO public."Case" (
       id, "orderId", "buyerId", "sellerId", reason, description,
       "sellerRespondBy", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, 'DAMAGED', 'Disposable activation Case.',
       CURRENT_TIMESTAMP + interval '2 days',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [ids.case, ids.order, ids.owner, ids.outsider],
  );
  await owner.query(
    `INSERT INTO public."CaseMessage" (
       id, "caseId", "authorId", "authorKind", body, "createdAt"
     ) VALUES (
       $1, $2, $3, 'BUYER', 'Disposable activation message.',
       CURRENT_TIMESTAMP
     )`,
    [ids.caseMessage, ids.case, ids.owner],
  );
}

async function catalogProof(owner) {
  const tables = await owner.query(
    `SELECT
       class.relname,
       class.relrowsecurity,
       class.relforcerowsecurity,
       (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_policy AS policy
         WHERE policy.polrelid = class.oid) AS policy_count,
       (
         pg_catalog.has_table_privilege($1, class.oid, 'SELECT')
         OR pg_catalog.has_table_privilege($1, class.oid, 'INSERT')
         OR pg_catalog.has_table_privilege($1, class.oid, 'UPDATE')
         OR pg_catalog.has_table_privilege($1, class.oid, 'DELETE')
         OR pg_catalog.has_table_privilege($1, class.oid, 'TRUNCATE')
         OR pg_catalog.has_table_privilege($1, class.oid, 'REFERENCES')
         OR pg_catalog.has_table_privilege($1, class.oid, 'TRIGGER')
       ) AS runtime_authority,
       (
         pg_catalog.has_table_privilege($2, class.oid, 'SELECT')
         OR pg_catalog.has_table_privilege($2, class.oid, 'INSERT')
         OR pg_catalog.has_table_privilege($2, class.oid, 'UPDATE')
         OR pg_catalog.has_table_privilege($2, class.oid, 'DELETE')
         OR pg_catalog.has_table_privilege($2, class.oid, 'TRUNCATE')
         OR pg_catalog.has_table_privilege($2, class.oid, 'REFERENCES')
         OR pg_catalog.has_table_privilege($2, class.oid, 'TRIGGER')
       ) AS cleanup_authority
     FROM pg_catalog.pg_class AS class
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname IN ('DirectUpload', 'DirectUploadReference')
      AND class.relkind = 'r'
    ORDER BY class.relname`,
    [RUNTIME_ROLE, CLEANUP_ROLE],
  );
  assert.deepEqual(tables.rows, [
    {
      relname: "DirectUpload",
      relrowsecurity: true,
      relforcerowsecurity: true,
      policy_count: 0,
      runtime_authority: false,
      cleanup_authority: false,
    },
    {
      relname: "DirectUploadReference",
      relrowsecurity: true,
      relforcerowsecurity: true,
      policy_count: 0,
      runtime_authority: false,
      cleanup_authority: false,
    },
  ]);

  const objectKey = await owner.query(
    `SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid =
        'public."CaseMessageAttachment"'::pg_catalog.regclass
        AND attribute.attname = 'objectKey'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped`,
  );
  assert.equal(objectKey.rowCount, 0);

  const functions = await owner.query(
     `SELECT
       procedure.proname,
       pg_catalog.pg_get_function_identity_arguments(procedure.oid)
         AS identity_arguments,
       procedure.prosecdef,
       procedure.proleakproof,
       procedure.proconfig,
       procedure.prosrc,
       procedure.proowner = (
         SELECT role.oid
           FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user
       ) AS owner_is_proof_role,
       pg_catalog.has_function_privilege(
         $1, procedure.oid, 'EXECUTE'
       ) AS runtime_execute,
       pg_catalog.has_function_privilege(
         $2, procedure.oid, 'EXECUTE'
       ) AS cleanup_execute,
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
      AND procedure.proname = ANY($3::text[])
    ORDER BY procedure.proname`,
    [
      RUNTIME_ROLE,
      CLEANUP_ROLE,
      DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) => entry.name),
    ],
  );
  assert.equal(functions.rows.length, 35);
  const byName = new Map(
    DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) => [entry.name, entry]),
  );
  const sourceHashes = directUploadFunctionSourceHashes();
  for (const row of functions.rows) {
    const expected = byName.get(row.proname);
    assert.ok(expected, `unexpected DirectUpload function ${row.proname}`);
    assert.equal(row.identity_arguments, expected.identityArguments);
    assert.equal(row.prosecdef, expected.securityDefiner);
    assert.equal(row.proleakproof, false);
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
    assert.equal(row.owner_is_proof_role, true);
    assert.equal(row.public_execute, false);
    assert.equal(row.runtime_execute, expected.runtimeExecute);
    assert.equal(row.cleanup_execute, expected.cleanupExecute);
    assert.equal(
      createHash("sha256").update(row.prosrc, "utf8").digest("hex"),
      sourceHashes[row.proname],
      `${row.proname} source hash drifted`,
    );
  }
}

async function directDenialProof(runtime, cleanup) {
  for (const [client, label] of [
    [runtime, "runtime"],
    [cleanup, "cleanup"],
  ]) {
    await expectSqlState(
      () => client.query('SELECT 1 FROM public."DirectUpload" LIMIT 1'),
      "42501",
      `${label} DirectUpload SELECT`,
    );
    await expectSqlState(
      () =>
        client.query(
          'SELECT 1 FROM public."DirectUploadReference" LIMIT 1',
        ),
      "42501",
      `${label} DirectUploadReference SELECT`,
    );
  }
  await expectSqlState(
    () =>
      runtime.query(
        "SELECT public.grainline_direct_upload_cleanup_lease(1)",
      ),
    "42501",
    "runtime cleanup lease",
  );
  await expectSqlState(
    () =>
      runtime.query(
        `SELECT public.grainline_direct_upload_record_private_message(
           $1, 'unreleased-conversation', 'messagePrivateImage/x/y.webp',
           'image/webp', 10
         )`,
        [ids.owner],
      ),
    "42501",
    "runtime unreleased private-message recorder",
  );
  await expectSqlState(
    () =>
      cleanup.query(
        `SELECT public.grainline_direct_upload_record_processed_public(
           $1, $2, 'listingImage', $3, 'image/webp', 1024
         )`,
        [ids.owner, publicKey, publicUrl],
      ),
    "42501",
    "cleanup ordinary upload recorder",
  );
}

async function fixedAuthorityProof(owner, runtime) {
  const recorded = await runtime.query(
    `SELECT public.grainline_direct_upload_record_processed_public(
       $1, $2, 'listingImage', $3, 'image/webp', 1024
     ) AS id`,
    [ids.owner, publicKey, publicUrl],
  );
  const uploadId = recorded.rows[0]?.id;
  assert.equal(typeof uploadId, "string");
  await owner.query(
    `INSERT INTO public."Photo" (
       id, "listingId", url, "originalUrl", "sortOrder", "createdAt"
     ) VALUES ($1, $2, $3, $3, 0, CURRENT_TIMESTAMP)`,
    [ids.photo, ids.listing, publicUrl],
  );
  assert.deepEqual(
    (
      await runtime.query(
        `SELECT referenced, released, untracked
           FROM public.grainline_direct_upload_sync_listing($1, $2)`,
        [ids.owner, ids.listing],
      )
    ).rows,
    [{ referenced: 1, released: 0, untracked: 0 }],
  );
  await expectSqlState(
    () =>
      runtime.query(
        `SELECT *
           FROM public.grainline_direct_upload_sync_listing($1, $2)`,
        [ids.outsider, ids.listing],
      ),
    "42501",
    "foreign Listing sync",
  );

  const privateRecorded = await runtime.query(
    `SELECT public.grainline_direct_upload_record_private_case(
       $1, $2, $3, 'image/webp', 2048
     ) AS id`,
    [ids.owner, ids.case, privateKey],
  );
  const privateUploadId = privateRecorded.rows[0]?.id;
  assert.equal(typeof privateUploadId, "string");
  await runtime.query(
    `INSERT INTO public."CaseMessageAttachment" (
       id, "caseMessageId", "uploaderId", "directUploadId",
       "contentType", "byteSize", "createdAt"
     ) VALUES (
       $1, $2, $3, $4, 'image/webp', 2048, CURRENT_TIMESTAMP
     )`,
    [ids.caseAttachment, ids.caseMessage, ids.owner, privateUploadId],
  );
  assert.equal(
    (
      await runtime.query(
        `SELECT public.grainline_direct_upload_reference_case_attachment(
           $1, $2
         ) AS referenced`,
        [ids.owner, ids.caseAttachment],
      )
    ).rows[0]?.referenced,
    true,
  );
  assert.deepEqual(
    (
      await runtime.query(
        `SELECT *
           FROM public.grainline_direct_upload_case_attachment_read(
             $1, $2, $3
           )`,
        [ids.owner, ids.case, ids.caseAttachment],
      )
    ).rows,
    [{ key: privateKey, contentType: "image/webp" }],
  );
  assert.deepEqual(
    (
      await runtime.query(
        `SELECT *
           FROM public.grainline_direct_upload_case_attachment_read(
             $1, $2, $3
           )`,
        [ids.outsider, ids.case, ids.caseAttachment],
      )
    ).rows,
    [{ key: privateKey, contentType: "image/webp" }],
  );
  return uploadId;
}

async function cleanupAuthorityProof(owner, runtime, cleanup, uploadId) {
  await owner.query(
    `DELETE FROM public."Photo" WHERE id = $1`,
    [ids.photo],
  );
  await runtime.query(
    `SELECT * FROM public.grainline_direct_upload_sync_listing($1, $2)`,
    [ids.owner, ids.listing],
  );
  await owner.query(
    `UPDATE public."DirectUpload"
        SET "cleanupAfter" = CURRENT_TIMESTAMP - interval '1 minute'
      WHERE id = $1`,
    [uploadId],
  );
  const leased = await cleanup.query(
    "SELECT * FROM public.grainline_direct_upload_cleanup_lease(20)",
  );
  const lease = leased.rows.find((row) => row.id === uploadId);
  assert.ok(lease, "cleanup role did not lease the expected upload");
  assert.equal(
    (
      await cleanup.query(
        `SELECT public.grainline_direct_upload_cleanup_complete(
           $1, 'wrong-lease'
         ) AS completed`,
        [uploadId],
      )
    ).rows[0]?.completed,
    false,
  );
  assert.equal(
    (
      await cleanup.query(
        `SELECT public.grainline_direct_upload_cleanup_complete(
           $1, $2
         ) AS completed`,
        [uploadId, lease.leaseId],
      )
    ).rows[0]?.completed,
    true,
  );
  assert.equal(
    (
      await owner.query(
        `SELECT status FROM public."DirectUpload" WHERE id = $1`,
        [uploadId],
      )
    ).rows[0]?.status,
    "DELETED",
  );
}

export async function runDirectUploadActivationProof(env = process.env) {
  const { databaseUrl } = parseDirectUploadActivationProofConfig(env);
  const owner = await connect(databaseUrl, `${PREFIX}-owner`);
  const runtime = await connect(
    databaseUrl,
    `${PREFIX}-runtime`,
    RUNTIME_ROLE,
  );
  const cleanup = await connect(
    databaseUrl,
    `${PREFIX}-cleanup`,
    CLEANUP_ROLE,
  );
  const checks = [];
  try {
    await catalogProof(owner);
    checks.push("activated_catalog_source_and_acl");
    await seedFixtures(owner);
    await directDenialProof(runtime, cleanup);
    checks.push("runtime_and_worker_direct_denial");
    const uploadId = await fixedAuthorityProof(owner, runtime);
    checks.push("runtime_fixed_authority_and_retired_case_key");
    await cleanupAuthorityProof(owner, runtime, cleanup, uploadId);
    checks.push("isolated_cleanup_lease_fence");
    return Object.freeze({
      ok: true,
      database: DATABASE_NAME,
      checks,
      persistentStagingChanged: false,
      productionChanged: false,
    });
  } finally {
    await cleanupFixtures(owner).catch(() => {});
    await cleanup.end().catch(() => {});
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

async function main() {
  try {
    const result = await runDirectUploadActivationProof();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload activation PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
