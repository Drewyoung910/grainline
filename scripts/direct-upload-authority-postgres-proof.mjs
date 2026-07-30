#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  DIRECT_UPLOAD_PRIVATE_FUNCTION_NAMES,
  DIRECT_UPLOAD_RUNTIME_FUNCTION_NAMES,
} from "./direct-upload-authority-catalog.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
} from "./direct-upload-activation-catalog.mjs";
import {
  DIRECT_UPLOAD_LEGACY_COUNTS_SQL,
  normalizeDirectUploadLegacyResult,
} from "./direct-upload-legacy-inspect.mjs";
import {
  directUploadFunctionSourceHashes,
} from "./direct-upload-function-source-catalog.mjs";
import {
  readDirectUploadCleanupRoleProvisionSnapshot,
} from "./direct-upload-cleanup-role-production-provision.mjs";

const { Client } = pg;

const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "DIRECT_UPLOAD_AUTHORITY_PROOF_DATABASE_URL";
const PREFIX = "direct-upload-authority-proof";
const RUNTIME_ROLE = "grainline_app_runtime";
const CLEANUP_ROLE = "grainline_direct_upload_cleanup_v2";
const ids = Object.freeze({
  owner: `${PREFIX}-owner`,
  outsider: `${PREFIX}-outsider`,
  ownerSeller: `${PREFIX}-owner-seller`,
  caseSeller: `${PREFIX}-case-seller`,
  listingA: `${PREFIX}-listing-a`,
  listingB: `${PREFIX}-listing-b`,
  caseListing: `${PREFIX}-case-listing`,
  orderItem: `${PREFIX}-order-item`,
  photoA: `${PREFIX}-photo-a`,
  photoB: `${PREFIX}-photo-b`,
  legacyPhoto: `${PREFIX}-legacy-photo`,
  broadcast: `${PREFIX}-broadcast`,
  order: `${PREFIX}-order`,
  case: `${PREFIX}-case`,
  caseMessageA: `${PREFIX}-case-message-a`,
  caseMessageB: `${PREFIX}-case-message-b`,
  caseAttachmentOld: `${PREFIX}-case-attachment-old`,
  caseAttachmentNew: `${PREFIX}-case-attachment-new`,
});
const actorSegments = Object.freeze({
  owner: "clerk-direct-upload-authority-proof-owner",
  outsider: "clerk-direct-upload-authority-proof-outsider",
  stranger: "clerk-direct-upload-authority-proof-stranger",
});
const strangerId = `${PREFIX}-stranger`;
const uploads = Object.freeze({
  a: {
    key: `listingImage/${actorSegments.owner}/a.webp`,
    url: `https://proof.invalid/listingImage/${actorSegments.owner}/a.webp`,
  },
  b: {
    key: `listingImage/${actorSegments.owner}/b.webp`,
    url: `https://proof.invalid/listingImage/${actorSegments.owner}/b.webp`,
  },
  privateA: {
    key: `caseEvidenceImage/${actorSegments.owner}/${ids.case}/old.webp`,
  },
  privateB: {
    key: `caseEvidenceImage/${actorSegments.owner}/${ids.case}/new.webp`,
  },
  accountDelete: {
    key: `reviewPhoto/${actorSegments.outsider}/account-delete.webp`,
    url: `https://proof.invalid/reviewPhoto/${actorSegments.outsider}/account-delete.webp`,
  },
});
const legacyUrl = "https://legacy.invalid/direct-upload-authority-proof.webp";

const runtimeFunctions = DIRECT_UPLOAD_RUNTIME_FUNCTION_NAMES;
const privateFunctions = DIRECT_UPLOAD_PRIVATE_FUNCTION_NAMES;

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
    `DELETE FROM public."CaseMessageAttachment" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(
    `DELETE FROM public."CaseMessage" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(
    `DELETE FROM public."Case" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(
    `DELETE FROM public."Order" WHERE id LIKE '${PREFIX}-%'`,
  );
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
             WHERE "userId" IN ($1, $2, $3)
          )
    `,
    [ids.owner, ids.outsider, strangerId],
  );
  await owner.query(
    `DELETE FROM public."DirectUpload" WHERE "userId" IN ($1, $2, $3)`,
    [ids.owner, ids.outsider, strangerId],
  );
  await owner.query(
    `DELETE FROM public."SellerProfile" WHERE id LIKE '${PREFIX}-%'`,
  );
  await owner.query(
    `DELETE FROM public."User" WHERE id IN ($1, $2, $3)`,
    [ids.owner, ids.outsider, strangerId],
  );
}

async function seedFixturesInTransaction(owner) {
  await owner.query(
    `
      INSERT INTO public."User" (
        id, "clerkId", email, name, role, banned, "createdAt", "updatedAt"
      )
      VALUES
        ($1, $2, $3, 'DirectUpload Proof Owner', 'USER', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ($4, $5, $6, 'DirectUpload Proof Outsider', 'USER', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ($7, $8, $9, 'DirectUpload Proof Stranger', 'USER', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [
      ids.owner,
      actorSegments.owner,
      `${PREFIX}-owner@example.invalid`,
      ids.outsider,
      actorSegments.outsider,
      `${PREFIX}-outsider@example.invalid`,
      strangerId,
      actorSegments.stranger,
      `${PREFIX}-stranger@example.invalid`,
    ],
  );
  await owner.query(
    `
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized",
        "createdAt", "updatedAt"
      )
      VALUES
        ($1, $2, 'DirectUpload Proof Seller',
         'directupload proof seller', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ($3, $4, 'DirectUpload Proof Case Seller',
         'directupload proof case seller', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [ids.ownerSeller, ids.owner, ids.caseSeller, ids.outsider],
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
         1000, 'IN_STOCK', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ($4, $5, 'DirectUpload proof Case listing', 'Disposable Case fixture.',
         1000, 'IN_STOCK', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [
      ids.listingA,
      ids.listingB,
      ids.ownerSeller,
      ids.caseListing,
      ids.caseSeller,
    ],
  );
  await owner.query(
    `
      INSERT INTO public."Order" (id, "buyerId")
      VALUES ($1, $2)
    `,
    [ids.order, ids.owner],
  );
  await owner.query(
    `
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", quantity, "priceCents"
      )
      VALUES ($1, $2, $3, 1, 1000)
    `,
    [ids.orderItem, ids.order, ids.caseListing],
  );
  await owner.query(
    `
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description,
        "sellerRespondBy", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, 'DAMAGED', 'Disposable DirectUpload proof Case.',
        CURRENT_TIMESTAMP + interval '2 days',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
    [ids.case, ids.order, ids.owner, ids.outsider],
  );
  await owner.query(
    `
      INSERT INTO public."CaseMessage" (
        id, "caseId", "authorId", "authorKind", body, "createdAt"
      )
      VALUES
        ($1, $3, $4, 'BUYER', 'Old-app compatibility proof.', CURRENT_TIMESTAMP),
        ($2, $3, $4, 'BUYER', 'New-app compatibility proof.', CURRENT_TIMESTAMP)
    `,
    [ids.caseMessageA, ids.caseMessageB, ids.case, ids.owner],
  );
}

async function seedFixtures(owner) {
  await cleanupFixtures(owner);
  await owner.query("BEGIN");
  try {
    await seedFixturesInTransaction(owner);
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
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

  const cleanupRole = await owner.query(
    `
      SELECT
             rolsuper,
             rolcreatedb,
             rolcreaterole,
             rolinherit,
             rolcanlogin,
             rolreplication,
             rolbypassrls
        FROM pg_catalog.pg_roles
       WHERE rolname = $1
    `,
    [CLEANUP_ROLE],
  );
  assert.deepEqual(cleanupRole.rows, [
    {
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolcanlogin: true,
      rolreplication: false,
      rolbypassrls: false,
    },
  ]);

  const cleanupMemberships = await owner.query(
    `
      WITH RECURSIVE parent_memberships AS (
        SELECT parent.oid, parent.rolname
          FROM pg_catalog.pg_auth_members AS edge
          JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
          JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
         WHERE child.rolname = $1
        UNION
        SELECT parent.oid, parent.rolname
          FROM parent_memberships AS child
          JOIN pg_catalog.pg_auth_members AS edge
            ON edge.member = child.oid
          JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
      ), member_roles AS (
        SELECT child.oid, child.rolname
          FROM pg_catalog.pg_auth_members AS edge
          JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
          JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
         WHERE parent.rolname = $1
        UNION
        SELECT child.oid, child.rolname
          FROM member_roles AS parent
          JOIN pg_catalog.pg_auth_members AS edge
            ON edge.roleid = parent.oid
          JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
      )
      SELECT 'parent' AS direction, rolname FROM parent_memberships
      UNION ALL
      SELECT 'member' AS direction, rolname FROM member_roles
      ORDER BY direction, rolname
    `,
    [CLEANUP_ROLE],
  );
  assert.deepEqual(cleanupMemberships.rows, []);

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
             procedure.prosrc,
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
  const expectedSourceHashes = directUploadFunctionSourceHashes();
  for (const row of functions.rows) {
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
    assert.equal(row.public_execute, false, `${row.proname} is executable by PUBLIC`);
    assert.equal(
      createHash("sha256").update(row.prosrc, "utf8").digest("hex"),
      expectedSourceHashes[row.proname],
      `${row.proname} source hash drifted`,
    );
    assert.equal(
      row.runtime_execute,
      runtimeFunctions.includes(row.proname),
      `${row.proname} has the wrong runtime EXECUTE posture`,
    );
    const expectedSecurityDefiner =
      !DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES.includes(row.proname);
    assert.equal(
      row.prosecdef,
      expectedSecurityDefiner,
      `${row.proname} has the wrong SECURITY posture`,
    );
  }

  const cleanupFunctions = await owner.query(
    `
      SELECT procedure.proname,
             pg_catalog.has_function_privilege(
               $1,
               procedure.oid,
               'EXECUTE'
             ) AS cleanup_execute,
             pg_catalog.has_function_privilege(
               $2,
               procedure.oid,
               'EXECUTE'
             ) AS runtime_execute
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname LIKE 'grainline\\_direct\\_upload\\_%'
               ESCAPE '\\'
       ORDER BY procedure.proname
    `,
    [CLEANUP_ROLE, RUNTIME_ROLE],
  );
  const cleanupExecuteNames = cleanupFunctions.rows
    .filter((row) => row.cleanup_execute)
    .map((row) => row.proname);
  assert.deepEqual(cleanupExecuteNames, [
    "grainline_direct_upload_cleanup_complete",
    "grainline_direct_upload_cleanup_fail",
    "grainline_direct_upload_cleanup_lease",
  ]);
  for (const row of cleanupFunctions.rows) {
    if (cleanupExecuteNames.includes(row.proname)) {
      assert.equal(
        row.runtime_execute,
        true,
        `${row.proname} must remain runtime-compatible during preparation`,
      );
    }
  }

  const cleanupNamespace = await owner.query(
    `
      SELECT
        pg_catalog.has_schema_privilege($1, 'public', 'USAGE')
          AS schema_usage,
        pg_catalog.has_schema_privilege($1, 'public', 'CREATE')
          AS schema_create,
        pg_catalog.has_database_privilege(
          $1,
          current_database(),
          'CREATE'
        ) AS database_create
    `,
    [CLEANUP_ROLE],
  );
  assert.deepEqual(cleanupNamespace.rows, [
    {
      schema_usage: true,
      schema_create: false,
      database_create: false,
    },
  ]);

  const cleanupTables = await owner.query(
    `
      SELECT class.relname
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND CASE
           WHEN class.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
             pg_catalog.has_table_privilege(
               $1,
               class.oid,
               'SELECT,INSERT,UPDATE,DELETE,REFERENCES'
             )
           ELSE false
         END
       ORDER BY class.relname
    `,
    [CLEANUP_ROLE],
  );
  assert.deepEqual(cleanupTables.rows, []);

  const cleanupTableAdministrativeAuthority = await owner.query(
    `
      SELECT class.relname
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relkind IN ('r', 'p')
         AND CASE
           WHEN class.relkind IN ('r', 'p') THEN
             pg_catalog.has_table_privilege(
               $1,
               class.oid,
               'TRUNCATE,TRIGGER'
             )
           ELSE false
         END
       ORDER BY class.relname
    `,
    [CLEANUP_ROLE],
  );
  assert.deepEqual(cleanupTableAdministrativeAuthority.rows, []);

  const cleanupColumns = await owner.query(
    `
      SELECT class.relname, attribute.attname
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = class.oid
       WHERE namespace.nspname = 'public'
         AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND CASE
           WHEN class.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
             pg_catalog.has_column_privilege(
               $1,
               class.oid,
               attribute.attnum,
               'SELECT,INSERT,UPDATE,REFERENCES'
             )
           ELSE false
         END
       ORDER BY class.relname, attribute.attnum
    `,
    [CLEANUP_ROLE],
  );
  assert.deepEqual(cleanupColumns.rows, []);

  const cleanupSequences = await owner.query(
    `
      SELECT class.relname
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relkind = 'S'
         AND CASE
           WHEN class.relkind = 'S' THEN
             pg_catalog.has_sequence_privilege(
               $1,
               class.oid,
               'USAGE,SELECT,UPDATE'
             )
           ELSE false
         END
       ORDER BY class.relname
    `,
    [CLEANUP_ROLE],
  );
  assert.deepEqual(cleanupSequences.rows, []);

  const cleanupDefaultPrivileges = await owner.query(
    `
      SELECT defaults.oid
        FROM pg_catalog.pg_default_acl AS defaults
        CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
       WHERE acl.grantee = (
         SELECT oid
           FROM pg_catalog.pg_roles
          WHERE rolname = $1
       )
    `,
    [CLEANUP_ROLE],
  );
  assert.deepEqual(cleanupDefaultPrivileges.rows, []);

  const cleanupUnexpectedFunctions = await owner.query(
    `
      SELECT procedure.proname
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND pg_catalog.has_function_privilege(
           $1,
           procedure.oid,
           'EXECUTE'
         )
         AND procedure.prosecdef
         AND procedure.proname <> ALL ($2::text[])
       ORDER BY procedure.proname
    `,
    [CLEANUP_ROLE, DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES],
  );
  assert.deepEqual(cleanupUnexpectedFunctions.rows, []);

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
    { relname: "CaseMessageAttachment", tgname: "grainline_direct_upload_release_case_attachment_delete" },
    { relname: "CommissionRequest", tgname: "grainline_direct_upload_release_commission_request_delete" },
    { relname: "Listing", tgname: "grainline_direct_upload_release_listing_delete" },
    { relname: "Message", tgname: "grainline_direct_upload_release_legacy_message_delete" },
    { relname: "Review", tgname: "grainline_direct_upload_release_review_delete" },
    { relname: "SellerBroadcast", tgname: "grainline_direct_upload_release_seller_broadcast_delete" },
    { relname: "SellerProfile", tgname: "grainline_direct_upload_release_seller_profile_delete" },
  ]);
}

async function recordPrivateCaseUpload(runtime, upload) {
  const result = await runtime.query(
    `
      SELECT public.grainline_direct_upload_record_private_case(
        $1, $2, $3, 'image/webp', 2048
      ) AS id
    `,
    [ids.owner, ids.case, upload.key],
  );
  assert.equal(typeof result.rows[0]?.id, "string");
  return result.rows[0].id;
}

async function caseAttachmentCompatibilityProof(owner, runtime) {
  const oldUploadId = await recordPrivateCaseUpload(runtime, uploads.privateA);

  await runtime.query("BEGIN");
  try {
    const oldClaim = await runtime.query(
      `
        UPDATE public."DirectUpload"
           SET status = 'CLAIMED',
               "claimedAt" = CURRENT_TIMESTAMP,
               "claimedByType" = 'CASE_MESSAGE_ATTACHMENT',
               "claimedById" = NULL,
               "cleanupAfter" = NULL,
               "lastError" = NULL
         WHERE id = $1
           AND status = 'VERIFIED'
      `,
      [oldUploadId],
    );
    assert.equal(oldClaim.rowCount, 1);
    await runtime.query(
      `
        INSERT INTO public."CaseMessageAttachment" (
          id, "caseMessageId", "uploaderId", "objectKey",
          "contentType", "byteSize", "createdAt"
        )
        VALUES ($1, $2, $3, $4, 'image/webp', 2048, CURRENT_TIMESTAMP)
      `,
      [
        ids.caseAttachmentOld,
        ids.caseMessageA,
        ids.owner,
        uploads.privateA.key,
      ],
    );
    const oldLink = await runtime.query(
      `
        UPDATE public."DirectUpload"
           SET "claimedById" = $2
         WHERE id = $1
           AND status = 'CLAIMED'
           AND "claimedByType" = 'CASE_MESSAGE_ATTACHMENT'
           AND "claimedById" IS NULL
      `,
      [oldUploadId, ids.caseAttachmentOld],
    );
    assert.equal(oldLink.rowCount, 1);
    await runtime.query("COMMIT");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => {});
    throw error;
  }

  const oldBinding = await owner.query(
    `
      SELECT
        attachment."objectKey",
        attachment."directUploadId",
        upload.status,
        upload."cleanupAfter" IS NULL AS cleanup_cancelled,
        reference.exclusive,
        reference."releasedAt"
      FROM public."CaseMessageAttachment" AS attachment
      JOIN public."DirectUpload" AS upload
        ON upload.id = attachment."directUploadId"
      JOIN public."DirectUploadReference" AS reference
        ON reference."directUploadId" = upload.id
       AND reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
       AND reference."sourceId" = attachment.id
      WHERE attachment.id = $1
    `,
    [ids.caseAttachmentOld],
  );
  assert.deepEqual(oldBinding.rows, [
    {
      objectKey: uploads.privateA.key,
      directUploadId: oldUploadId,
      status: "CLAIMED",
      cleanup_cancelled: true,
      exclusive: true,
      releasedAt: null,
    },
  ]);

  const replay = await runtime.query(
    `
      SELECT public.grainline_direct_upload_reference_case_attachment(
        $1, $2
      ) AS referenced
    `,
    [ids.owner, ids.caseAttachmentOld],
  );
  assert.equal(replay.rows[0]?.referenced, true);
  assert.equal(await activeReferenceCount(owner, oldUploadId), 1);

  const ownerRead = await runtime.query(
    `
      SELECT *
      FROM public.grainline_direct_upload_case_attachment_read($1, $2, $3)
    `,
    [ids.owner, ids.case, ids.caseAttachmentOld],
  );
  assert.deepEqual(ownerRead.rows, [
    { key: uploads.privateA.key, contentType: "image/webp" },
  ]);
  const sellerRead = await runtime.query(
    `
      SELECT *
      FROM public.grainline_direct_upload_case_attachment_read($1, $2, $3)
    `,
    [ids.outsider, ids.case, ids.caseAttachmentOld],
  );
  assert.deepEqual(sellerRead.rows, ownerRead.rows);
  const strangerRead = await runtime.query(
    `
      SELECT *
      FROM public.grainline_direct_upload_case_attachment_read($1, $2, $3)
    `,
    [strangerId, ids.case, ids.caseAttachmentOld],
  );
  assert.deepEqual(strangerRead.rows, []);

  const newUploadId = await recordPrivateCaseUpload(runtime, uploads.privateB);
  await expectSqlState(
    () =>
      runtime.query(
        `
          INSERT INTO public."CaseMessageAttachment" (
            id, "caseMessageId", "uploaderId", "objectKey", "directUploadId",
            "contentType", "byteSize", "createdAt"
          )
          VALUES ($1, $2, $3, $4, $5, 'image/webp', 2048, CURRENT_TIMESTAMP)
        `,
        [
          `${ids.caseAttachmentNew}-mismatch`,
          ids.caseMessageB,
          ids.owner,
          uploads.privateB.key,
          oldUploadId,
        ],
      ),
    "23514",
    "mismatched Case attachment key and DirectUpload id",
  );

  await runtime.query("BEGIN");
  try {
    await runtime.query(
      `
        INSERT INTO public."CaseMessageAttachment" (
          id, "caseMessageId", "uploaderId", "objectKey", "directUploadId",
          "contentType", "byteSize", "createdAt"
        )
        VALUES ($1, $2, $3, $4, $5, 'image/webp', 2048, CURRENT_TIMESTAMP)
      `,
      [
        ids.caseAttachmentNew,
        ids.caseMessageB,
        ids.owner,
        uploads.privateB.key,
        newUploadId,
      ],
    );
    const newReference = await runtime.query(
      `
        SELECT public.grainline_direct_upload_reference_case_attachment(
          $1, $2
        ) AS referenced
      `,
      [ids.owner, ids.caseAttachmentNew],
    );
    assert.equal(newReference.rows[0]?.referenced, true);
    await runtime.query("COMMIT");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => {});
    throw error;
  }
  assert.equal(await activeReferenceCount(owner, newUploadId), 1);

  await expectSqlState(
    () =>
      runtime.query(
        `
          UPDATE public."CaseMessageAttachment"
             SET "caseMessageId" = $2
           WHERE id = $1
        `,
        [ids.caseAttachmentNew, ids.caseMessageA],
      ),
    "23514",
    "mutable Case attachment parent",
  );

  await runtime.query(
    `DELETE FROM public."CaseMessageAttachment" WHERE id = $1`,
    [ids.caseAttachmentOld],
  );
  const released = await owner.query(
    `
      SELECT
        upload.status,
        upload."cleanupAfter" IS NOT NULL AS cleanup_ready,
        reference."releasedAt" IS NOT NULL AS released,
        reference."releaseReason"
      FROM public."DirectUpload" AS upload
      JOIN public."DirectUploadReference" AS reference
        ON reference."directUploadId" = upload.id
       AND reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
       AND reference."sourceId" = $2
      WHERE upload.id = $1
    `,
    [oldUploadId, ids.caseAttachmentOld],
  );
  assert.deepEqual(released.rows, [
    {
      status: "VERIFIED",
      cleanup_ready: true,
      released: true,
      releaseReason: "SOURCE_DELETED",
    },
  ]);
  await owner.query(
    `
      UPDATE public."DirectUpload"
         SET "cleanupAfter" = CURRENT_TIMESTAMP + interval '1 day'
       WHERE id = $1
    `,
    [oldUploadId],
  );
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
    assert.equal(
      skippedLease.rows.some((row) => row.id === uploadA),
      false,
      "cleanup leased the upload while reference creation held its row lock",
    );
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

async function aggregateLegacyInspectionQueryProof(owner) {
  const result = await owner.query(
    DIRECT_UPLOAD_LEGACY_COUNTS_SQL,
    ["https://proof.invalid"],
  );
  const { counts } = normalizeDirectUploadLegacyResult(result.rows[0]);
  assert.equal(counts.caseAttachmentCount, 1);
  assert.equal(counts.caseAttachmentKeyIdMismatchCount, 0);
  assert.equal(counts.caseAttachmentMetadataMismatchCount, 0);
  assert.equal(counts.caseAttachmentMissingActiveReferenceCount, 0);
  assert.equal(counts.caseAttachmentDuplicateActiveReferenceCount, 0);
  assert.equal(counts.unrepairableLifecycleRowCount, 0);
  assert.ok(counts.firstPartyDurableSourceUrlCount >= 1);
}

async function bannedAccountLifecycleCleanupProof(owner, runtime) {
  const recorded = await runtime.query(
    `
      SELECT public.grainline_direct_upload_record_processed_public(
        $1, $2, 'reviewPhoto', $3, 'image/webp', 1024
      ) AS id
    `,
    [ids.outsider, uploads.accountDelete.key, uploads.accountDelete.url],
  );
  const uploadId = recorded.rows[0]?.id;
  assert.equal(typeof uploadId, "string");

  await owner.query(
    `UPDATE public."User" SET banned = true WHERE id = $1`,
    [ids.outsider],
  );

  const publicUrls = await runtime.query(
    `
      SELECT "publicUrl"
        FROM public.grainline_direct_upload_account_public_urls($1)
    `,
    [ids.outsider],
  );
  assert.deepEqual(publicUrls.rows, [{ publicUrl: uploads.accountDelete.url }]);

  const exportRows = await runtime.query(
    `SELECT id FROM public.grainline_direct_upload_export($1)`,
    [ids.outsider],
  );
  assert.equal(
    exportRows.rowCount,
    0,
    "ordinary DirectUpload export must stay denied for a banned actor",
  );

  const released = await runtime.query(
    `
      SELECT public.grainline_direct_upload_release_for_account($1) AS released
    `,
    [ids.outsider],
  );
  assert.equal(released.rows[0]?.released, 0);

  const lifecycle = await owner.query(
    `
      SELECT status,
             "cleanupAfter" IS NOT NULL
               AND "cleanupAfter" <= public.grainline_direct_upload_utc_now()
               AS cleanup_ready
        FROM public."DirectUpload"
       WHERE id = $1
    `,
    [uploadId],
  );
  assert.deepEqual(lifecycle.rows, [
    {
      status: "VERIFIED",
      cleanup_ready: true,
    },
  ]);
}

async function cleanupRoleProductionPostflightQueryProof(owner) {
  await owner.query("BEGIN TRANSACTION READ ONLY");
  try {
    const snapshot =
      await readDirectUploadCleanupRoleProvisionSnapshot(owner);
    assert.equal(snapshot.currentUser, "ci");
    assert.equal(snapshot.sessionUser, "ci");
    assert.equal(snapshot.transactionReadOnly, "on");
    assert.equal(snapshot.role?.rolname, CLEANUP_ROLE);
    assert.equal(snapshot.functions.length, 35);
    assert.equal(snapshot.tables.length, 2);
    assert.deepEqual(snapshot.memberships, []);
    assert.deepEqual(snapshot.memberRoles, []);
    assert.deepEqual(snapshot.tablePrivileges, []);
    assert.deepEqual(snapshot.columnPrivileges, []);
    assert.deepEqual(snapshot.sequencePrivileges, []);
    assert.deepEqual(snapshot.defaultPrivileges, []);
    assert.deepEqual(snapshot.unexpectedFunctionPrivileges, []);
  } finally {
    await owner.query("ROLLBACK");
  }
}

export async function runProof(env = process.env) {
  const { databaseUrl } = parseProofConfig(env);
  const owner = await connect(databaseUrl, `${PREFIX}-owner`);
  const runtime = await connect(databaseUrl, `${PREFIX}-runtime`, true);
  const checks = [];
  try {
    await catalogProof(owner);
    checks.push("catalog_and_acl");
    await cleanupRoleProductionPostflightQueryProof(owner);
    checks.push("cleanup_role_production_postflight_query");
    await seedFixtures(owner);
    const { uploadA } = await authorityProof(owner, runtime);
    checks.push("fixed_authority_and_partial_source");
    await caseAttachmentCompatibilityProof(owner, runtime);
    checks.push("case_attachment_compatibility_and_lifecycle");
    await swapConcurrencyProof(databaseUrl, owner);
    checks.push("stable_swap_lock_order");
    await sourceReuseProof(owner, runtime, uploadA);
    checks.push("multi_source_reuse_and_delete_release");
    await cleanupConcurrencyProof(databaseUrl, owner, owner, runtime, uploadA);
    checks.push("reference_cleanup_winner_orderings");
    await aggregateLegacyInspectionQueryProof(owner);
    checks.push("aggregate_only_legacy_query");
    await bannedAccountLifecycleCleanupProof(owner, runtime);
    checks.push("banned_account_lifecycle_cleanup");
    assert.equal(checks.length, 9);
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
