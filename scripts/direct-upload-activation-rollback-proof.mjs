#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
  DIRECT_UPLOAD_CLEANUP_ROLE,
} from "./direct-upload-activation-catalog.mjs";

const { Client } = pg;
const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "DIRECT_UPLOAD_ACTIVATION_ROLLBACK_PROOF_DATABASE_URL";
const RUNTIME_ROLE = "grainline_app_runtime";
const PREFIX = "direct-upload-activation-rollback-proof";
const fixture = Object.freeze({
  userId: `${PREFIX}-user`,
  clerkId: `${PREFIX}-clerk`,
  uploadId: `${PREFIX}-upload`,
  key: `listingImage/${PREFIX}-clerk/fixture.webp`,
});
const rollbackRuntimeFunctionNames = new Set([
  ...DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
    .filter((entry) => entry.runtimeExecute)
    .map((entry) => entry.name),
  "grainline_direct_upload_record_private_message",
  "grainline_direct_upload_cleanup_lease",
  "grainline_direct_upload_cleanup_complete",
  "grainline_direct_upload_cleanup_fail",
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

export function parseDirectUploadRollbackProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "DirectUpload rollback proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `DirectUpload rollback proof requires ${DATABASE_NAME}`,
  );
  return Object.freeze({ databaseUrl });
}

async function connect(databaseUrl, applicationName, role) {
  const client = new Client({
    connectionString: applicationUrl(databaseUrl, applicationName),
  });
  await client.connect();
  if (role) await client.query(`SET ROLE ${role}`);
  return client;
}

function functionIdentity(entry) {
  return `public.${entry.name}(${entry.identityArguments})`;
}

function functionAclStatements({ rollback }) {
  const revokes = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) =>
    `REVOKE ALL ON FUNCTION ${functionIdentity(entry)}
       FROM PUBLIC, ${RUNTIME_ROLE}, ${DIRECT_UPLOAD_CLEANUP_ROLE}`)
    .join(";\n");
  const runtime = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
    .filter((entry) =>
      rollback
        ? rollbackRuntimeFunctionNames.has(entry.name)
        : entry.runtimeExecute)
    .map((entry) =>
      `GRANT EXECUTE ON FUNCTION ${functionIdentity(entry)}
         TO ${RUNTIME_ROLE}`)
    .join(";\n");
  const cleanup = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
    .filter((entry) => entry.cleanupExecute)
    .map((entry) =>
      `GRANT EXECUTE ON FUNCTION ${functionIdentity(entry)}
         TO ${DIRECT_UPLOAD_CLEANUP_ROLE}`)
    .join(";\n");
  return `${revokes};\n${runtime};\n${cleanup};`;
}

async function readTableCatalog(owner) {
  const result = await owner.query(
    `SELECT
       class.relname,
       class.relrowsecurity,
       class.relforcerowsecurity,
       (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_policy AS policy
         WHERE policy.polrelid = class.oid) AS policy_count,
       pg_catalog.has_table_privilege($1, class.oid, 'SELECT')
         AS runtime_select,
       pg_catalog.has_table_privilege($1, class.oid, 'INSERT')
         AS runtime_insert,
       pg_catalog.has_table_privilege($1, class.oid, 'UPDATE')
         AS runtime_update,
       pg_catalog.has_table_privilege($1, class.oid, 'DELETE')
         AS runtime_delete,
       (
         pg_catalog.has_table_privilege($1, class.oid, 'TRUNCATE')
         OR pg_catalog.has_table_privilege($1, class.oid, 'REFERENCES')
         OR pg_catalog.has_table_privilege($1, class.oid, 'TRIGGER')
       ) AS runtime_other,
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
    [RUNTIME_ROLE, DIRECT_UPLOAD_CLEANUP_ROLE],
  );
  assert.equal(result.rows.length, 2);
  return result.rows;
}

function expectedTableCatalog({ rollback }) {
  return [
    {
      relname: "DirectUpload",
      relrowsecurity: !rollback,
      relforcerowsecurity: true,
      policy_count: 0,
      runtime_select: rollback,
      runtime_insert: rollback,
      runtime_update: rollback,
      runtime_delete: rollback,
      runtime_other: false,
      cleanup_authority: false,
    },
    {
      relname: "DirectUploadReference",
      relrowsecurity: true,
      relforcerowsecurity: true,
      policy_count: 0,
      runtime_select: false,
      runtime_insert: false,
      runtime_update: false,
      runtime_delete: false,
      runtime_other: false,
      cleanup_authority: false,
    },
  ];
}

async function assertFunctionCatalog(owner, { rollback }) {
  const result = await owner.query(
    `SELECT
       procedure.proname,
       pg_catalog.oidvectortypes(procedure.proargtypes)
         AS identity_arguments,
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
      AND procedure.proname LIKE 'grainline\\_direct\\_upload\\_%'
        ESCAPE '\\'
    ORDER BY procedure.proname, identity_arguments`,
    [RUNTIME_ROLE, DIRECT_UPLOAD_CLEANUP_ROLE],
  );
  assert.equal(result.rows.length, DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.length);
  const expectedByIdentity = new Map(
    DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) => [
      `${entry.name}(${entry.identityArguments})`,
      entry,
    ]),
  );
  for (const row of result.rows) {
    const identity = `${row.proname}(${row.identity_arguments})`;
    const expected = expectedByIdentity.get(identity);
    assert.ok(expected, `unexpected DirectUpload function ${identity}`);
    assert.equal(row.public_execute, false, `${identity} is PUBLIC`);
    assert.equal(
      row.runtime_execute,
      rollback
        ? rollbackRuntimeFunctionNames.has(expected.name)
        : expected.runtimeExecute,
      `${identity} runtime ACL drifted`,
    );
    assert.equal(
      row.cleanup_execute,
      expected.cleanupExecute,
      `${identity} cleanup ACL drifted`,
    );
  }
}

async function setCompatibilityState(owner) {
  await owner.query("BEGIN");
  try {
    await owner.query("SET LOCAL lock_timeout = '10s'");
    await owner.query("SET LOCAL statement_timeout = '60s'");
    await owner.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended(
           'grainline.direct-upload.rls.activation',
           0
         )
       )`,
    );
    await owner.query(
      `LOCK TABLE
         public."DirectUpload",
         public."DirectUploadReference"
       IN ACCESS EXCLUSIVE MODE`,
    );
    await owner.query(
      'ALTER TABLE public."DirectUpload" DISABLE ROW LEVEL SECURITY',
    );
    await owner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE
         ON TABLE public."DirectUpload"
         TO grainline_app_runtime`,
    );
    await owner.query(functionAclStatements({ rollback: true }));
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function restoreActivation(owner) {
  await owner.query("BEGIN");
  try {
    await owner.query("SET LOCAL lock_timeout = '10s'");
    await owner.query("SET LOCAL statement_timeout = '60s'");
    await owner.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended(
           'grainline.direct-upload.rls.activation',
           0
         )
       )`,
    );
    await owner.query(
      `LOCK TABLE
         public."DirectUpload",
         public."DirectUploadReference"
       IN ACCESS EXCLUSIVE MODE`,
    );
    await owner.query(
      `REVOKE ALL ON TABLE
         public."DirectUpload",
         public."DirectUploadReference"
       FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup`,
    );
    await owner.query(functionAclStatements({ rollback: false }));
    await owner.query(
      'ALTER TABLE public."DirectUpload" ENABLE ROW LEVEL SECURITY',
    );
    await owner.query(
      'ALTER TABLE public."DirectUpload" FORCE ROW LEVEL SECURITY',
    );
    await owner.query(
      'ALTER TABLE public."DirectUploadReference" ENABLE ROW LEVEL SECURITY',
    );
    await owner.query(
      'ALTER TABLE public."DirectUploadReference" FORCE ROW LEVEL SECURITY',
    );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function cleanupFixture(owner) {
  await owner.query(
    `DELETE FROM public."DirectUpload" WHERE id = $1`,
    [fixture.uploadId],
  );
  await owner.query(
    `DELETE FROM public."User" WHERE id = $1`,
    [fixture.userId],
  );
}

async function proveOldApplicationCrud(owner, runtime) {
  await cleanupFixture(owner);
  await owner.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, role, banned, "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, 'DirectUpload rollback proof', 'USER', false,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [
      fixture.userId,
      fixture.clerkId,
      `${PREFIX}@example.invalid`,
    ],
  );
  const publicUrl = `https://proof.invalid/${fixture.key}`;
  await runtime.query(
    `INSERT INTO public."DirectUpload" (
       id, key, endpoint, "userId", "publicUrl", "storageClass",
       "contentType", "expectedSize", status, "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 'listingImage', $3, $4, 'PUBLIC',
       'image/webp', 1024, 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [fixture.uploadId, fixture.key, fixture.userId, publicUrl],
  );
  await runtime.query(
    `UPDATE public."DirectUpload"
        SET "lastError" = 'rollback-compatible', "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [fixture.uploadId],
  );
  assert.deepEqual(
    (
      await runtime.query(
        `SELECT id, key, "lastError"
           FROM public."DirectUpload"
          WHERE id = $1`,
        [fixture.uploadId],
      )
    ).rows,
    [{
      id: fixture.uploadId,
      key: fixture.key,
      lastError: "rollback-compatible",
    }],
  );
  assert.deepEqual(
    (
      await runtime.query(
        `DELETE FROM public."DirectUpload"
          WHERE id = $1
        RETURNING id`,
        [fixture.uploadId],
      )
    ).rows,
    [{ id: fixture.uploadId }],
  );
  await owner.query(
    `DELETE FROM public."User" WHERE id = $1`,
    [fixture.userId],
  );
}

export async function runDirectUploadActivationRollbackProof(
  env = process.env,
) {
  const { databaseUrl } = parseDirectUploadRollbackProofConfig(env);
  const owner = await connect(databaseUrl, `${PREFIX}-owner`);
  const runtime = await connect(
    databaseUrl,
    `${PREFIX}-runtime`,
    RUNTIME_ROLE,
  );
  let compatibilityCommitted = false;
  let activationRestored = false;
  try {
    assert.deepEqual(
      await readTableCatalog(owner),
      expectedTableCatalog({ rollback: false }),
    );
    await assertFunctionCatalog(owner, { rollback: false });

    await setCompatibilityState(owner);
    compatibilityCommitted = true;
    assert.deepEqual(
      await readTableCatalog(owner),
      expectedTableCatalog({ rollback: true }),
    );
    await assertFunctionCatalog(owner, { rollback: true });
    await proveOldApplicationCrud(owner, runtime);

    await restoreActivation(owner);
    activationRestored = true;
    assert.deepEqual(
      await readTableCatalog(owner),
      expectedTableCatalog({ rollback: false }),
    );
    await assertFunctionCatalog(owner, { rollback: false });
    const residue = await owner.query(
      `SELECT
         (SELECT pg_catalog.count(*)::integer
            FROM public."DirectUpload"
           WHERE id = $1) AS upload_count,
         (SELECT pg_catalog.count(*)::integer
            FROM public."User"
           WHERE id = $2) AS user_count,
         (SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid =
             'public."CaseMessageAttachment"'::pg_catalog.regclass
             AND attribute.attname = 'objectKey'
             AND attribute.attnum > 0
             AND NOT attribute.attisdropped) AS object_key_count`,
      [fixture.uploadId, fixture.userId],
    );
    assert.deepEqual(residue.rows, [{
      upload_count: 0,
      user_count: 0,
      object_key_count: 0,
    }]);

    return Object.freeze({
      ok: true,
      database: DATABASE_NAME,
      databaseFirstCompatibilityRollbackVerified: true,
      oldApplicationDirectCrudCompatible: true,
      exactFunctionPartitionRestored: true,
      exactForceActivationRestored: true,
      objectKeyRetirementPreserved: true,
      productionChanged: false,
      persistentStagingChanged: false,
    });
  } finally {
    if (compatibilityCommitted && !activationRestored) {
      await cleanupFixture(owner).catch(() => {});
      await restoreActivation(owner).catch(() => {});
    }
    await runtime.query("RESET ROLE").catch(() => {});
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

async function main() {
  try {
    const result = await runDirectUploadActivationRollbackProof();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload activation rollback proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
