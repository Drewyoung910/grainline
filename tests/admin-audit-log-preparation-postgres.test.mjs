import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261102010000_prepare_admin_audit_log_authorities/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_account_deletion_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;

    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TYPE public."ListingStatus" AS ENUM (
      'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED'
    );

    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      role public."Role" NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "bannedAt" timestamp(3) without time zone,
      "banReason" text,
      "bannedBy" text,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id)
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      title text NOT NULL,
      status public."ListingStatus" NOT NULL DEFAULT 'DRAFT',
      "isPrivate" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."BlogPost" (id text PRIMARY KEY);
    CREATE TABLE public."BlogComment" (
      id text PRIMARY KEY,
      approved boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Review" (id text PRIMARY KEY);
    CREATE TABLE public."AdminAuditLog" (
      id text PRIMARY KEY,
      "adminId" text NOT NULL REFERENCES public."User"(id),
      action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL,
      "targetId" varchar(255) NOT NULL,
      reason varchar(1000),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      undone boolean NOT NULL DEFAULT false,
      "undoneAt" timestamp(3) without time zone,
      "undoneBy" text,
      "undoneReason" varchar(500),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "AdminAuditLog_adminId_idx"
      ON public."AdminAuditLog" ("adminId");
    CREATE INDEX "AdminAuditLog_createdAt_idx"
      ON public."AdminAuditLog" ("createdAt");
    CREATE INDEX "AdminAuditLog_targetType_targetId_idx"
      ON public."AdminAuditLog" ("targetType", "targetId");
    CREATE INDEX "AdminAuditLog_undone_idx"
      ON public."AdminAuditLog" (undone);
    CREATE TABLE public."AccountDeletionSideEffect" (
      id text PRIMARY KEY,
      "userId" varchar(191) NOT NULL,
      kind varchar(40) NOT NULL,
      "dedupKey" varchar(300) NOT NULL UNIQUE,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status varchar(20) NOT NULL DEFAULT 'PENDING',
      attempts integer NOT NULL DEFAULT 0,
      "claimGeneration" bigint NOT NULL DEFAULT 0,
      "claimToken" uuid,
      "processingStartedAt" timestamp(3) without time zone,
      "nextAttemptAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "lastError" varchar(1000),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE FUNCTION public.grainline_account_deletion_claim_user(
      p_side_effect_id text,
      p_claim_generation bigint,
      p_claim_token uuid
    )
    RETURNS text
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $proof_claim_user$
    DECLARE
      claimed_user_id text;
    BEGIN
      UPDATE public."AccountDeletionSideEffect" AS effect
         SET "processingStartedAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE effect.id = p_side_effect_id
         AND effect.status = 'PROCESSING'
         AND effect.kind = 'LOCAL_ANONYMIZE'
         AND effect."dedupKey" = 'account-delete:local:' || effect."userId"
         AND effect.payload = '{}'::jsonb
         AND effect."claimGeneration" = p_claim_generation
         AND effect."claimToken" = p_claim_token
      RETURNING effect."userId" INTO claimed_user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Account deletion claim is not authorized'
          USING ERRCODE = '42501';
      END IF;
      RETURN claimed_user_id;
    END;
    $proof_claim_user$;

    GRANT SELECT, INSERT, UPDATE, DELETE
      ON public."AdminAuditLog" TO grainline_app_runtime;

    INSERT INTO public."User" (id, role) VALUES
      ('proof-admin', 'ADMIN'),
      ('proof-admin-two', 'ADMIN'),
      ('proof-employee', 'EMPLOYEE'),
      ('proof-user', 'USER'),
      ('proof-seller', 'USER');
    INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('proof-shop', 'proof-seller');
    INSERT INTO public."Listing" (
      id, "sellerId", title, status, "isPrivate"
    ) VALUES
      ('proof-ai-listing', 'proof-shop', 'AI review', 'PENDING_REVIEW', false),
      ('proof-removed-listing', 'proof-shop', 'Removed listing', 'REJECTED', true);
    INSERT INTO public."BlogPost" (id) VALUES ('proof-post');
    INSERT INTO public."BlogComment" (id, approved)
      VALUES ('proof-approved-comment', true);
  `);
  await database.exec(migration);
  return database;
}

async function asRuntime(database, actorId, query, params = []) {
  await database.exec("BEGIN");
  try {
    await database.exec("SET LOCAL ROLE grainline_app_runtime");
    if (actorId) {
      await database.query(
        "SELECT pg_catalog.set_config('app.user_id', $1, true)",
        [actorId],
      );
    }
    const result = await database.query(query, params);
    await database.exec("COMMIT");
    return result;
  } catch (error) {
    await database.exec("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function asAccountDeletionRuntime(database, query, params = []) {
  await database.exec("SET SESSION AUTHORIZATION grainline_account_deletion_runtime");
  try {
    return await database.query(query, params);
  } finally {
    // PGlite does not restore the bootstrap user for RESET/DEFAULT here.
    // Production proofs connect as the dedicated role instead.
    await database.exec("SET SESSION AUTHORIZATION postgres");
  }
}

async function asAppRuntimeSession(database, actorId, query, params = []) {
  await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
  try {
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [actorId],
    );
    return await database.query(query, params);
  } finally {
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', '', false)",
    ).catch(() => {});
    await database.exec("SET SESSION AUTHORIZATION postgres");
  }
}

function appendSql() {
  return `
    SELECT * FROM public.grainline_admin_audit_append(
      $1, $2, $3, $4, $5, $6::jsonb
    )
  `;
}

test("AdminAuditLog preparation preserves predecessor access and adds exact ACLs", async () => {
  const database = await readyDatabase();
  try {
    const catalog = await database.query(`
      SELECT relation.relrowsecurity AS enabled,
             relation.relforcerowsecurity AS forced,
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', relation.oid, 'SELECT'
             ) AS runtime_select,
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', relation.oid, 'INSERT'
             ) AS runtime_insert,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_admin_audit_append(text,text,text,text,text,jsonb)',
               'EXECUTE'
             ) AS runtime_append,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)',
               'EXECUTE'
             ) AS runtime_undo_claim,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_admin_audit_staff_undo_source(text,text)',
               'EXECUTE'
             ) AS runtime_undo_source,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_admin_audit_staff_page(text,text,integer,integer)',
               'EXECUTE'
             ) AS runtime_staff_page,
             pg_catalog.has_function_privilege(
               'grainline_staff_read_runtime',
               'public.grainline_admin_audit_staff_page(text,text,integer,integer)',
               'EXECUTE'
             ) AS staff_page,
             pg_catalog.has_function_privilege(
               'grainline_staff_read_runtime',
               'public.grainline_admin_audit_append(text,text,text,text,text,jsonb)',
               'EXECUTE'
             ) AS staff_append,
             pg_catalog.has_function_privilege(
               'grainline_staff_read_runtime',
               'public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)',
               'EXECUTE'
             ) AS staff_undo_claim,
             pg_catalog.has_function_privilege(
               'grainline_staff_read_runtime',
               'public.grainline_admin_audit_staff_undo_source(text,text)',
               'EXECUTE'
             ) AS staff_undo_source,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)',
               'EXECUTE'
             ) AS runtime_ban_repair_append,
             pg_catalog.has_function_privilege(
               'grainline_staff_read_runtime',
               'public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)',
               'EXECUTE'
             ) AS staff_ban_repair_append,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)',
               'EXECUTE'
             ) AS runtime_deletion_fence,
             pg_catalog.has_function_privilege(
               'grainline_account_deletion_runtime',
               'public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)',
               'EXECUTE'
             ) AS deletion_fence,
             pg_catalog.has_function_privilege(
               'grainline_staff_read_runtime',
               'public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)',
               'EXECUTE'
             ) AS staff_deletion_fence,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)',
               'EXECUTE'
             ) AS runtime_deletion_candidates,
             pg_catalog.has_function_privilege(
               'grainline_account_deletion_runtime',
               'public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)',
               'EXECUTE'
             ) AS deletion_candidates,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)',
               'EXECUTE'
             ) AS runtime_plan_enqueue,
             pg_catalog.has_function_privilege(
               'grainline_account_deletion_runtime',
               'public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)',
               'EXECUTE'
             ) AS deletion_plan_enqueue,
             pg_catalog.has_function_privilege(
               'grainline_staff_read_runtime',
               'public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)',
               'EXECUTE'
             ) AS staff_deletion_apply,
             pg_catalog.has_function_privilege(
               'grainline_account_deletion_runtime',
               'public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)',
               'EXECUTE'
             ) AS deletion_apply,
             pg_catalog.has_function_privilege(
               'grainline_account_deletion_runtime',
               'public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)',
               'EXECUTE'
             ) AS deletion_legacy_apply,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)',
               'EXECUTE'
             ) AS runtime_deletion_legacy_apply
        FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = 'public."AdminAuditLog"'::pg_catalog.regclass
    `);
    assert.deepEqual(catalog.rows[0], {
      enabled: false,
      forced: false,
      runtime_select: true,
      runtime_insert: true,
      runtime_append: true,
      runtime_undo_claim: true,
      runtime_undo_source: false,
      runtime_staff_page: false,
      staff_page: true,
      staff_append: false,
      staff_undo_claim: false,
      staff_undo_source: true,
      runtime_ban_repair_append: false,
      staff_ban_repair_append: true,
      runtime_deletion_fence: true,
      deletion_fence: false,
      staff_deletion_fence: false,
      runtime_deletion_candidates: true,
      deletion_candidates: false,
      runtime_plan_enqueue: true,
      deletion_plan_enqueue: false,
      staff_deletion_apply: false,
      deletion_apply: true,
      deletion_legacy_apply: true,
      runtime_deletion_legacy_apply: false,
    });
  } finally {
    await database.close();
  }
});

test("account deletion drains legacy redactions without restoring newer redacted data", async () => {
  const database = await readyDatabase();
  try {
    const claimToken = "11111111-1111-4111-8111-111111111111";
    await database.query(
      `INSERT INTO public."User" (id) VALUES ('proof-deleted')`,
    );
    await database.query(
      `INSERT INTO public."AdminAuditLog" (
         id, "adminId", action, "targetType", "targetId", metadata,
         reason, undone, "undoneAt", "undoneBy", "undoneReason"
       ) VALUES
       (
         'proof-delete-audit', 'proof-deleted', 'USER_ACCOUNT_DELETE',
         'USER', 'proof-deleted', '{"actorKind":"user"}'::jsonb, NULL,
         false, NULL, NULL, NULL
       ),
       (
         'proof-legacy-target', 'proof-admin', 'BAN_USER', 'USER',
         'proof-deleted', '{"userId":"proof-deleted"}'::jsonb,
         'deleted proof-deleted', true, '2026-11-02 10:01:00'::timestamp,
         'proof-admin-two', 'reviewed reversal'
       ),
       (
         'proof-legacy-conflict', 'proof-admin', 'BAN_USER', 'USER',
         'proof-deleted',
         '{"redactedForAccountDeletion":true,"newer":"kept"}'::jsonb,
         NULL, false, NULL, NULL, NULL
       )`,
    );
    await database.query(
      `UPDATE public."User"
          SET "deletedAt"='2026-11-02 10:00:00'::timestamp
        WHERE id='proof-deleted'`,
    );
    await database.query(
      `INSERT INTO public."AccountDeletionSideEffect" (
         id, "userId", kind, "dedupKey", payload, status,
         "claimGeneration", "claimToken", "processingStartedAt"
       ) VALUES (
         'proof-legacy-effect', 'proof-deleted', 'AUDIT_REDACT',
         'account-delete:audit:proof-deleted:proof-legacy-target',
         $1::jsonb, 'PROCESSING', 1, $2::uuid, CURRENT_TIMESTAMP
       )`,
      [
        JSON.stringify({
          logId: "proof-legacy-target",
          metadata: {
            userId: "[deleted account]",
            redactedForAccountDeletion: true,
          },
          reason: "deleted [deleted account]",
        }),
        claimToken,
      ],
    );

    const applied = await asAccountDeletionRuntime(
      database,
      `SELECT public.grainline_admin_audit_account_deletion_legacy_redaction_apply(
         $1, 1, $2::uuid, $3
       ) AS applied`,
      ["proof-legacy-effect", claimToken, "proof-legacy-target"],
    );
    assert.equal(applied.rows[0].applied, true);
    const stored = await database.query(
      `SELECT metadata, reason, undone, "undoneBy", "undoneReason"
         FROM public."AdminAuditLog" WHERE id='proof-legacy-target'`,
    );
    assert.deepEqual(stored.rows[0], {
      metadata: {
        userId: "[deleted account]",
        redactedForAccountDeletion: true,
      },
      reason: "deleted [deleted account]",
      undone: true,
      undoneBy: "proof-admin-two",
      undoneReason: "reviewed reversal",
    });
    const scrubbed = await database.query(
      `SELECT payload, status, "processedAt", "processingStartedAt",
              "nextAttemptAt", "lastError"
         FROM public."AccountDeletionSideEffect"
        WHERE id='proof-legacy-effect'`,
    );
    const { processedAt, ...scrubbedState } = scrubbed.rows[0];
    assert.ok(processedAt instanceof Date);
    assert.deepEqual(scrubbedState, {
      payload: {},
      status: "DONE",
      processingStartedAt: null,
      nextAttemptAt: null,
      lastError: null,
    });

    await database.query(
      `INSERT INTO public."AccountDeletionSideEffect" (
         id, "userId", kind, "dedupKey", payload, status,
         "claimGeneration", "claimToken", "processingStartedAt"
       ) VALUES (
         'proof-legacy-conflict-effect', 'proof-deleted', 'AUDIT_REDACT',
         'account-delete:audit:proof-deleted:proof-legacy-conflict',
         '{"logId":"proof-legacy-conflict","metadata":{"redactedForAccountDeletion":true,"older":"unsafe"}}'::jsonb,
         'PROCESSING', 1, $1::uuid, CURRENT_TIMESTAMP
       )`,
      [claimToken],
    );
    await assert.rejects(
      asAccountDeletionRuntime(
        database,
        `SELECT public.grainline_admin_audit_account_deletion_legacy_redaction_apply(
           $1, 1, $2::uuid, $3
         )`,
        ["proof-legacy-conflict-effect", claimToken, "proof-legacy-conflict"],
      ),
      /conflicts with a newer redaction/u,
    );
    const conflict = await database.query(
      `SELECT metadata FROM public."AdminAuditLog"
        WHERE id='proof-legacy-conflict'`,
    );
    assert.deepEqual(conflict.rows[0].metadata, {
      redactedForAccountDeletion: true,
      newer: "kept",
    });
  } finally {
    await database.close();
  }
});

test("audit insert fence refuses every structural reference to an already deleted user", async () => {
  const database = await readyDatabase();
  try {
    await database.query(
      `INSERT INTO public."User" (id, "deletedAt")
       VALUES ('proof-fenced-deleted', '2026-11-02 10:30:00'::timestamp)`,
    );
    for (const [id, adminId, targetType, targetId, metadata] of [
      ["proof-fence-admin", "proof-fenced-deleted", "OTHER", "safe", {}],
      ["proof-fence-target", "proof-admin", "USER", "proof-fenced-deleted", {}],
      [
        "proof-fence-metadata",
        "proof-admin",
        "OTHER",
        "safe",
        { nested: { userId: "proof-fenced-deleted" } },
      ],
    ]) {
      await assert.rejects(
        database.query(
          `INSERT INTO public."AdminAuditLog" (
             id, "adminId", action, "targetType", "targetId", metadata
           ) VALUES ($1, $2, 'TERMS_ACCEPTED', $3, $4, $5::jsonb)`,
          [id, adminId, targetType, targetId, JSON.stringify(metadata)],
        ),
        /references a deleted account/u,
      );
    }
    await database.query(
      `INSERT INTO public."AdminAuditLog" (
         id, "adminId", action, "targetType", "targetId", metadata
       ) VALUES (
         'proof-fence-unrelated', 'proof-admin', 'TERMS_ACCEPTED',
         'OTHER', 'safe', '{"nested":{"userId":"proof-user"}}'::jsonb
       )`,
    );
  } finally {
    await database.close();
  }
});

test("account deletion redaction compare-and-set completes the claimed job atomically", async () => {
  const database = await readyDatabase();
  try {
    const claimToken = "22222222-2222-4222-8222-222222222222";
    await database.query(
      `INSERT INTO public."User" (id) VALUES ('proof-current-deleted')`,
    );
    await database.query(
      `INSERT INTO public."AdminAuditLog" (
         id, "adminId", action, "targetType", "targetId", metadata,
         reason, undone, "undoneAt", "undoneBy", "undoneReason"
       ) VALUES
       (
         'proof-current-delete-audit', 'proof-current-deleted',
         'USER_ACCOUNT_DELETE', 'USER', 'proof-current-deleted',
         '{"actorKind":"user"}'::jsonb, NULL, false, NULL, NULL, NULL
       ),
       (
         'proof-current-target', 'proof-admin', 'BAN_USER', 'USER',
         'proof-current-deleted',
         '{"userId":"proof-current-deleted","safe":"keep"}'::jsonb,
         'deleted proof-current-deleted', true,
         '2026-11-02 11:01:00'::timestamp, 'proof-admin-two', 'reviewed reversal'
       )`,
    );
    await database.query(
      `UPDATE public."User"
          SET "deletedAt"='2026-11-02 11:00:00'::timestamp
        WHERE id='proof-current-deleted'`,
    );
    await database.query(
      `INSERT INTO public."AccountDeletionSideEffect" (
         id, "userId", kind, "dedupKey", payload, status,
         "claimGeneration", "claimToken", "processingStartedAt"
       ) VALUES (
         'proof-current-local', 'proof-current-deleted', 'LOCAL_ANONYMIZE',
         'account-delete:local:proof-current-deleted', '{}'::jsonb,
         'PROCESSING', 1, $1::uuid, CURRENT_TIMESTAMP
       )`,
      [claimToken],
    );
    await assert.rejects(
      asAppRuntimeSession(
        database,
        "proof-admin",
        `SELECT public.grainline_admin_audit_account_deletion_write_fence(
           $1, 1, $2::uuid
         )`,
        ["proof-current-local", claimToken],
      ),
      /write-fence actor is invalid/u,
    );
    const fenced = await asAppRuntimeSession(
      database,
      "proof-current-deleted",
      `SELECT public.grainline_admin_audit_account_deletion_write_fence(
         $1, 1, $2::uuid
       ) AS "userId"`,
      ["proof-current-local", claimToken],
    );
    assert.equal(fenced.rows[0].userId, "proof-current-deleted");
    await assert.rejects(
      asAppRuntimeSession(
        database,
        "proof-admin",
        `SELECT * FROM public.grainline_admin_audit_account_deletion_candidates(
           $1, 1, $2::uuid, $3::text[], $4::text[], NULL, 10
         )`,
        [
          "proof-current-local",
          claimToken,
          ["proof-current-deleted"],
          ["proof-current-deleted"],
        ],
      ),
      /candidate actor is invalid/u,
    );
    const candidates = await asAppRuntimeSession(
      database,
      "proof-current-deleted",
      `SELECT * FROM public.grainline_admin_audit_account_deletion_candidates(
         $1, 1, $2::uuid, $3::text[], $4::text[], NULL, 10
       )`,
      [
        "proof-current-local",
        claimToken,
        ["proof-current-deleted"],
        ["proof-current-deleted"],
      ],
    );
    const candidate = candidates.rows.find((row) => row.id === "proof-current-target");
    assert.ok(candidate);
    assert.match(candidate.metadataSha256, /^[0-9a-f]{64}$/u);
    assert.match(candidate.reasonSha256, /^[0-9a-f]{64}$/u);

    const payload = {
      logId: "proof-current-target",
      planVersion: 2,
      expectedMetadataSha256: candidate.metadataSha256,
      expectedReasonSha256: candidate.reasonSha256,
      metadata: {
        userId: "[deleted account]",
        safe: "keep",
        redactedForAccountDeletion: true,
      },
      reason: "deleted [deleted account]",
    };
    assert.doesNotMatch(JSON.stringify(payload), /proof-current-deleted/u);
    await assert.rejects(
      asAppRuntimeSession(
        database,
        "proof-current-deleted",
        `SELECT public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(
           $1, 1, $2::uuid, $3::text[], $4::text[], $5::jsonb
         )`,
        [
          "proof-current-local",
          claimToken,
          ["proof-current-deleted"],
          ["proof-current-deleted"],
          JSON.stringify([{
            ...payload,
            expectedMetadataSha256: "0".repeat(64),
          }]),
        ],
      ),
      /plan source changed/u,
    );
    const absentAfterRejectedPlan = await database.query(
      `SELECT count(*)::integer AS count
         FROM public."AccountDeletionSideEffect"
        WHERE "dedupKey" =
          'account-delete:audit:proof-current-deleted:proof-current-target'`,
    );
    assert.equal(absentAfterRejectedPlan.rows[0].count, 0);
    const enqueued = await asAppRuntimeSession(
      database,
      "proof-current-deleted",
      `SELECT public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(
         $1, 1, $2::uuid, $3::text[], $4::text[], $5::jsonb
       ) AS "enqueuedCount"`,
      [
        "proof-current-local",
        claimToken,
        ["proof-current-deleted"],
        ["proof-current-deleted"],
        JSON.stringify([payload]),
      ],
    );
    assert.equal(enqueued.rows[0].enqueuedCount, 1);
    const planned = await database.query(
      `SELECT id, payload FROM public."AccountDeletionSideEffect"
        WHERE "dedupKey" =
          'account-delete:audit:proof-current-deleted:proof-current-target'`,
    );
    assert.equal(planned.rows.length, 1);
    assert.deepEqual(planned.rows[0].payload, payload);
    const effectId = planned.rows[0].id;
    await database.query(
      `UPDATE public."AccountDeletionSideEffect"
          SET status='PROCESSING', "claimGeneration"=1,
              "claimToken"=$2::uuid, "processingStartedAt"=CURRENT_TIMESTAMP
        WHERE id=$1`,
      [effectId, claimToken],
    );

    const applied = await asAccountDeletionRuntime(
      database,
      `SELECT public.grainline_admin_audit_account_deletion_redaction_apply(
         $1, 1, $2::uuid, $3
       ) AS applied`,
      [
        effectId,
        claimToken,
        "proof-current-target",
      ],
    );
    assert.equal(applied.rows[0].applied, true);
    const stored = await database.query(
      `SELECT audit.metadata, audit.reason, audit.undone, audit."undoneBy",
              audit."undoneReason", effect.status, effect.payload,
              effect."processedAt", effect."processingStartedAt"
         FROM public."AdminAuditLog" AS audit
         JOIN public."AccountDeletionSideEffect" AS effect
           ON effect.id=$1
        WHERE audit.id='proof-current-target'`,
      [effectId],
    );
    assert.deepEqual(stored.rows[0].metadata, {
      userId: "[deleted account]",
      safe: "keep",
      redactedForAccountDeletion: true,
    });
    assert.equal(stored.rows[0].reason, "deleted [deleted account]");
    assert.equal(stored.rows[0].undone, true);
    assert.equal(stored.rows[0].undoneBy, "proof-admin-two");
    assert.equal(stored.rows[0].undoneReason, "reviewed reversal");
    assert.equal(stored.rows[0].status, "DONE");
    assert.deepEqual(stored.rows[0].payload, {});
    assert.ok(stored.rows[0].processedAt instanceof Date);
    assert.equal(stored.rows[0].processingStartedAt, null);
  } finally {
    await database.close();
  }
});

test("account deletion redaction refuses a stale source fingerprint without changing either row", async () => {
  const database = await readyDatabase();
  try {
    const claimToken = "33333333-3333-4333-8333-333333333333";
    await database.query(
      `INSERT INTO public."User" (id) VALUES ('proof-stale-deleted')`,
    );
    await database.query(
      `INSERT INTO public."AdminAuditLog" (
         id, "adminId", action, "targetType", "targetId", metadata
       ) VALUES
       (
         'proof-stale-delete-audit', 'proof-stale-deleted',
         'USER_ACCOUNT_DELETE', 'USER', 'proof-stale-deleted',
         '{"actorKind":"user"}'::jsonb
       ),
       (
         'proof-stale-target', 'proof-admin', 'BAN_USER', 'USER',
         'proof-stale-deleted', '{"safe":"newer"}'::jsonb
       )`,
    );
    await database.query(
      `UPDATE public."User"
          SET "deletedAt"='2026-11-02 12:00:00'::timestamp
        WHERE id='proof-stale-deleted'`,
    );
    await database.query(
      `INSERT INTO public."AccountDeletionSideEffect" (
         id, "userId", kind, "dedupKey", payload, status,
         "claimGeneration", "claimToken", "processingStartedAt"
       ) VALUES (
         'proof-stale-effect', 'proof-stale-deleted', 'AUDIT_REDACT',
         'account-delete:audit:proof-stale-deleted:proof-stale-target',
         $1::jsonb, 'PROCESSING', 1, $2::uuid, CURRENT_TIMESTAMP
       )`,
      [
        JSON.stringify({
          logId: "proof-stale-target",
          planVersion: 2,
          expectedMetadataSha256: "0".repeat(64),
          expectedReasonSha256: "0".repeat(64),
          metadata: { safe: "older", redactedForAccountDeletion: true },
        }),
        claimToken,
      ],
    );

    const applied = await asAccountDeletionRuntime(
      database,
      `SELECT public.grainline_admin_audit_account_deletion_redaction_apply(
         $1, 1, $2::uuid, $3
       ) AS applied`,
      ["proof-stale-effect", claimToken, "proof-stale-target"],
    );
    assert.equal(applied.rows[0].applied, false);
    const state = await database.query(
      `SELECT audit.metadata, effect.status, effect.payload
         FROM public."AdminAuditLog" AS audit
         JOIN public."AccountDeletionSideEffect" AS effect
           ON effect.id = 'proof-stale-effect'
        WHERE audit.id = 'proof-stale-target'`,
    );
    assert.deepEqual(state.rows[0].metadata, { safe: "newer" });
    assert.equal(state.rows[0].status, "PROCESSING");
    assert.equal(state.rows[0].payload.expectedMetadataSha256, "0".repeat(64));
  } finally {
    await database.close();
  }
});

test("undo claim binds the exact source and atomically records one undo", async () => {
  const database = await readyDatabase();
  try {
    const created = await asRuntime(database, "proof-admin", appendSql(), [
      "proof-admin", "REMOVE_LISTING", "Listing", "proof-removed-listing", null,
      JSON.stringify({ title: "Removed listing", sellerId: "proof-shop" }),
    ]);
    const logId = created.rows[0].id;
    const source = await database.query(
      `SELECT id, "adminId", action, "targetType", "targetId", metadata, "createdAt"
         FROM public."AdminAuditLog" WHERE id=$1`,
      [logId],
    );
    const row = source.rows[0];
    const claimSql = `
      SELECT public.grainline_admin_audit_undo_claim(
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb
      ) AS id
    `;

    await assert.rejects(
      asRuntime(database, "proof-admin-two", claimSql, [
        "proof-admin-two", row.id, "reviewed reversal", row.adminId,
        row.action, row.targetType, row.targetId, JSON.stringify({ changed: true }),
      ]),
      /Action changed before undo/u,
    );

    const undo = await asRuntime(database, "proof-admin-two", claimSql, [
      "proof-admin-two", row.id, "reviewed reversal", row.adminId,
      row.action, row.targetType, row.targetId, JSON.stringify(row.metadata),
    ]);
    assert.equal(undo.rows.length, 1);

    const stored = await database.query(
      `SELECT source.undone, source."undoneBy", source."undoneReason",
              undo.action, undo.metadata->>'originalActionId' AS original_action_id
         FROM public."AdminAuditLog" AS source
         JOIN public."AdminAuditLog" AS undo ON undo.id=$2
        WHERE source.id=$1`,
      [row.id, undo.rows[0].id],
    );
    assert.deepEqual(stored.rows[0], {
      undone: true,
      undoneBy: "proof-admin-two",
      undoneReason: "reviewed reversal",
      action: "UNDO_REMOVE_LISTING",
      original_action_id: row.id,
    });

    await assert.rejects(
      asRuntime(database, "proof-admin-two", claimSql, [
        "proof-admin-two", row.id, "second reversal", row.adminId,
        row.action, row.targetType, row.targetId, JSON.stringify(row.metadata),
      ]),
      /Already undone/u,
    );
  } finally {
    await database.close();
  }
});

test("actor-bound append accepts every converted action family and fixes actor kind", async () => {
  const database = await readyDatabase();
  try {
    const cases = [
      ["proof-user", "ACCOUNT_EXPORT", "USER", "proof-user", null, { actorKind: "staff" }],
      ["proof-admin", "ADMIN_PIN_VERIFY_OK", "USER", "proof-admin", null, {}],
      ["proof-employee", "APPROVE_GUILD_MEMBER_BLOCKED", "SELLER_PROFILE", "proof-shop", "blocked", {}],
      ["proof-seller", "AI_HOLD_LISTING", "LISTING", "proof-ai-listing", "held", {}],
      ["proof-employee", "APPROVE_BLOG_COMMENT", "BLOG_COMMENT", "proof-approved-comment", null, {}],
      ["proof-employee", "DELETE_BLOG_COMMENT", "BLOG_COMMENT", "proof-deleted-comment", null, {
        postId: "proof-post", authorId: "proof-user",
      }],
      ["proof-admin", "DELETE_REVIEW", "Review", "proof-deleted-review", null, {
        listingId: "proof-ai-listing", reviewerId: "proof-user",
      }],
      ["proof-admin", "SEND_EMAIL", "USER", "proof-user", "subject", {}],
      ["proof-admin", "REMOVE_LISTING", "Listing", "proof-removed-listing", null, {
        title: "Removed listing", sellerId: "proof-shop",
      }],
    ];
    for (const [actor, action, targetType, targetId, reason, metadata] of cases) {
      const result = await asRuntime(database, actor, appendSql(), [
        actor, action, targetType, targetId, reason, JSON.stringify(metadata),
      ]);
      assert.equal(result.rows.length, 1, action);
    }

    await database.query(`
      UPDATE public."User"
         SET banned = true,
             "bannedAt" = '2026-11-02 12:34:56.789'::timestamp,
             "bannedBy" = 'proof-admin'
       WHERE id = 'proof-user'
    `);
    const ban = await asRuntime(database, "proof-admin", appendSql(), [
      "proof-admin", "BAN_USER", "USER", "proof-user", "policy violation",
      JSON.stringify({
        externalSyncVersion: 1,
        appliedBannedAt: "2026-11-02T12:34:56.789Z",
      }),
    ]);
    assert.equal(ban.rows.length, 1);
    const banId = ban.rows[0].id;
    for (const action of [
      "BAN_USER_CLERK_SYNC",
      "BAN_USER_CHECKOUT_SESSIONS_EXPIRED",
    ]) {
      const sideEffect = await asRuntime(database, "proof-admin", appendSql(), [
        "proof-admin", action, "USER", "proof-user", null,
        JSON.stringify({ originalActionId: banId }),
      ]);
      assert.equal(sideEffect.rows.length, 1, action);
    }

    await database.query(`
      UPDATE public."User"
         SET banned = false, "bannedAt" = NULL, "bannedBy" = NULL
       WHERE id = 'proof-user'
    `);
    const unban = await asRuntime(database, "proof-admin", appendSql(), [
      "proof-admin", "UNBAN_USER", "USER", "proof-user", "appeal accepted",
      JSON.stringify({ previousUser: { banned: true } }),
    ]);
    assert.equal(unban.rows.length, 1);
    const unbanId = unban.rows[0].id;
    const unbanSync = await asRuntime(database, "proof-admin", appendSql(), [
      "proof-admin", "UNBAN_USER_CLERK_SYNC", "USER", "proof-user", null,
      JSON.stringify({ originalActionId: unbanId }),
    ]);
    assert.equal(unbanSync.rows.length, 1);
    await database.query(
      'UPDATE public."AdminAuditLog" SET undone=true WHERE id=$1',
      [banId],
    );
    const undoSync = await asRuntime(database, "proof-admin", appendSql(), [
      "proof-admin", "UNDO_BAN_USER_CLERK_SYNC", "USER", "proof-user", null,
      JSON.stringify({ originalActionId: banId }),
    ]);
    assert.equal(undoSync.rows.length, 1);

    const stored = await database.query(`
      SELECT action, metadata->>'actorKind' AS actor_kind
        FROM public."AdminAuditLog"
       ORDER BY action
    `);
    const actorKinds = new Map(stored.rows.map((row) => [row.action, row.actor_kind]));
    assert.equal(actorKinds.get("ACCOUNT_EXPORT"), "user");
    assert.equal(actorKinds.get("AI_HOLD_LISTING"), "automated");
    assert.equal(actorKinds.get("ADMIN_PIN_VERIFY_OK"), "staff");
    assert.equal(actorKinds.get("REMOVE_LISTING"), "staff");
    assert.equal(actorKinds.get("BAN_USER"), "staff");
    assert.equal(actorKinds.get("UNBAN_USER"), "staff");
  } finally {
    await database.close();
  }
});

test("actor-bound append denies missing, mismatched, disabled and forged contexts", async () => {
  const database = await readyDatabase();
  try {
    await assert.rejects(
      asRuntime(database, null, appendSql(), [
        "proof-user", "ACCOUNT_EXPORT", "USER", "proof-user", null, "{}",
      ]),
      /actor context is invalid/u,
    );
    await assert.rejects(
      asRuntime(database, "proof-user", appendSql(), [
        "proof-admin", "ACCOUNT_EXPORT", "USER", "proof-admin", null, "{}",
      ]),
      /actor context is invalid/u,
    );
    await assert.rejects(
      asRuntime(database, "proof-user", appendSql(), [
        "proof-user", "ADMIN_PIN_VERIFY_OK", "USER", "proof-user", null, "{}",
      ]),
      /PIN actor is invalid/u,
    );
    await assert.rejects(
      asRuntime(database, "proof-admin", appendSql(), [
        "proof-admin", "ARBITRARY_ADMIN_ACTION", "USER", "proof-user", null, "{}",
      ]),
      /action is not available/u,
    );
    await database.query(
      'UPDATE public."User" SET banned=true WHERE id=$1',
      ["proof-user"],
    );
    await assert.rejects(
      asRuntime(database, "proof-user", appendSql(), [
        "proof-user", "ACCOUNT_EXPORT", "USER", "proof-user", null, "{}",
      ]),
      /actor context is invalid/u,
    );
    const bannedDeletion = await asRuntime(database, "proof-user", appendSql(), [
      "proof-user", "USER_ACCOUNT_DELETE", "USER", "proof-user",
      "provider deletion", "{}",
    ]);
    assert.equal(bannedDeletion.rows.length, 1);
    await assert.rejects(
      asRuntime(
        database,
        "proof-admin",
        "SELECT public.grainline_admin_audit_staff_count($1, NULL)",
        ["proof-admin"],
      ),
      /permission denied/u,
    );
  } finally {
    await database.close();
  }
});
