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
             ) AS staff_append
        FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = 'public."AdminAuditLog"'::pg_catalog.regclass
    `);
    assert.deepEqual(catalog.rows[0], {
      enabled: false,
      forced: false,
      runtime_select: true,
      runtime_insert: true,
      runtime_append: true,
      runtime_staff_page: false,
      staff_page: true,
      staff_append: false,
    });
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
