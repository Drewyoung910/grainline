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
             ) AS staff_ban_repair_append
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
    });
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
