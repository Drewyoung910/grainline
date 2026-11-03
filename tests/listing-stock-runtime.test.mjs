import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { z } from "zod";
import * as stock from "../src/lib/stockMutationState.ts";
import * as receipts from "../src/lib/listingStockMutation.ts";

let db;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE','SOLD_OUT','DRAFT','HIDDEN','REJECTED','PENDING_REVIEW','SOLD');
    CREATE TABLE "Listing" (id text PRIMARY KEY, "sellerId" text, title text,
      "stockQuantity" integer, status "ListingStatus", "isPrivate" boolean DEFAULT false,
      "listingType" text DEFAULT 'IN_STOCK', "archivedAt" timestamp,
      "rejectionReason" text, "updatedAt" timestamp DEFAULT now());
    CREATE TABLE "SystemAuditLog" (id text PRIMARY KEY, "actorType" text, "actorId" text,
      action text, "targetType" text, "targetId" text, metadata jsonb);`);
});
after(async () => { await db?.close(); });
function port(connection) {
  return {
    $queryRaw: async (parts, ...values) => {
      const sql = parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      if (sql.includes("grainline_listing_owner_stock_lock")) {
        return (await connection.query(`SELECT id, title, "stockQuantity", "listingType",
          status::text AS status, "isPrivate", "archivedAt", "rejectionReason"
          FROM "Listing" WHERE id=$1 AND "sellerId"=$2 FOR UPDATE`, values)).rows;
      }
      if (sql.includes("grainline_listing_owner_stock_apply")) {
        return (await connection.query(`WITH previous_listing AS MATERIALIZED (
          SELECT id, "stockQuantity", status FROM "Listing"
          WHERE id=$1 AND "sellerId"=$2 FOR UPDATE
        )
        UPDATE "Listing" AS target SET
          "stockQuantity"=CASE WHEN $3::boolean
            THEN GREATEST(0,COALESCE(target."stockQuantity",0)+$4::integer)
            ELSE $5::integer END,
          status=CASE
            WHEN target.status='ACTIVE' AND
              (CASE WHEN $3::boolean THEN GREATEST(0,COALESCE(target."stockQuantity",0)+$4::integer) ELSE $5::integer END)<=0
              THEN 'SOLD_OUT'::"ListingStatus"
            WHEN target.status='SOLD_OUT' AND NOT target."isPrivate" AND
              (CASE WHEN $3::boolean THEN GREATEST(0,COALESCE(target."stockQuantity",0)+$4::integer) ELSE $5::integer END)>0
              THEN 'ACTIVE'::"ListingStatus"
            ELSE target.status END,
          "updatedAt"=now()
        FROM previous_listing AS previous WHERE target.id=previous.id
        RETURNING target.id, target.title, target."stockQuantity", target.status::text AS status,
          previous."stockQuantity" AS "previousStockQuantity", previous.status::text AS "previousStatus"`, values)).rows;
      }
      return (await connection.query(sql, values)).rows;
    },
    systemAuditLog: {
      findUnique: async ({ where }) => (await connection.query('SELECT * FROM "SystemAuditLog" WHERE id=$1', [where.id])).rows[0] ?? null,
      create: async ({ data }) => {
        const id = data.id ?? crypto.randomUUID();
        await connection.query('INSERT INTO "SystemAuditLog" VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [id, data.actorType, data.actorId, data.action, data.targetType, data.targetId, JSON.stringify(data.metadata)]);
        return { id };
      },
    },
  };
}
async function reset(quantity = 5, status = "DRAFT") {
  await db.exec('TRUNCATE "Listing", "SystemAuditLog"');
  await db.query('INSERT INTO "Listing" (id,"sellerId",title,"stockQuantity",status) VALUES ($1,$2,$3,$4,$5)',
    ["listing", "seller", "Test piece", quantity, status]);
}
async function quantity() { return (await db.query('SELECT "stockQuantity" FROM "Listing"')).rows[0].stockQuantity; }
function route({ failGuild = false, authenticated = true, owned = true, rejectReceipt = false, beforeTransaction } = {}) {
  const tx = port(db);
  const prisma = { ...tx,
    $transaction: async (run) => {
      if (beforeTransaction) await beforeTransaction();
      return db.transaction((connection) => {
        const client = port(connection);
        if (rejectReceipt) client.systemAuditLog.create = async () => { throw Error("receipt failure"); };
        return run(client);
      });
    },
  };
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: authenticated ? "clerk_owner" : null }) },
    "next/server": { after() {} }, "@sentry/nextjs": { captureException() {} },
    "@/lib/db": { prisma }, "@/lib/apiAccountAccess": { accountAccessErrorResponse: () => null },
    "@/lib/dbUserContext": { withDbUserContext: (_actorId, run) => prisma.$transaction(run) },
    "@/lib/privateResponse": { privateJson: (data, init) => Response.json(data, init), privateResponse: (x) => x },
    "@/lib/notifications": { createNotification: async () => {}, shouldSendEmail: async () => false },
    "@/lib/notificationSources": { NOTIFICATION_SOURCE_TYPES: {} },
    "@/lib/notificationOwnerAccess": { findRecentOwnerLowStockNotification: async () => null },
    "@/lib/stockNotificationAccess": { stockNotificationRestockCandidates: async () => [] },
    "@/lib/notificationServiceAccess": {}, "@/lib/email": {}, "@/lib/emailOutbox": {},
    "@/lib/userEmailDeliveryAccess": { userEmailDeliveryRecipients: async () => [] },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "owner" }) },
    "@/lib/listingOwnerAccess": { listingOwnerActionState: async () => {
      const row = (await db.query('SELECT * FROM "Listing"')).rows[0];
      return row && owned ? { ...row, sellerId: row.sellerId } : null;
    } },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }) },
    "@/lib/concurrency": {}, "@/lib/stockMutationState": stock,
    "@/lib/listingStockMutation": receipts,
    "@/lib/searchCache": { revalidateFeaturedMakerCaches() {}, revalidateListingSearchCaches() {} },
    "@/lib/guildListingThreshold": { syncGuildMemberListingThreshold: async () => { if (failGuild) throw Error("post-commit guild failure"); } },
    "@/lib/requestBody": { readBoundedJson: (req) => req.json(), isInvalidJsonBodyError: () => false, isRequestBodyTooLargeError: () => false },
    "@/lib/serverErrorLogger": { logServerError() {} },
    "@/lib/systemAudit": { logSystemActionOrThrow: ({ client, ...data }) => client.systemAuditLog.create({ data }).then((row) => row.id) },
    zod: { z },
  };
  const { outputText } = ts.transpileModule(readFileSync("src/app/api/listings/[id]/stock/route.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, routeModule, routeModule.exports);
  const alias = ts.transpileModule(readFileSync("src/app/api/listings/[id]/stock/adjustments/route.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const aliasModule = { exports: {} };
  new Function("require", "module", "exports", alias.outputText)((name) => {
    assert.equal(name, "../route"); return routeModule.exports;
  }, aliasModule, aliasModule.exports);
  assert.equal(aliasModule.exports.PATCH, routeModule.exports.PATCH);
  return (payload) => aliasModule.exports.PATCH(new Request("http://localhost/stock/adjustments", { method: "PATCH", body: JSON.stringify(payload) }),
    { params: Promise.resolve({ id: "listing" }) });
}
function attempt(overrides = {}) {
  return { quantity: 10, expectedQuantity: 5, mutationId: crypto.randomUUID(), issuedAt: Date.now(), ...overrides };
}
test("actual route applies one adjustment when a committed response is lost", async () => {
  await reset(); const patch = route(); const input = attempt();
  assert.equal((await patch(input)).status, 200);
  assert.equal((await patch(input)).status, 200);
  assert.equal(await quantity(), 10);
});
test("actual route recovers a post-commit failure without repeating its delta", async () => {
  await reset(); const input = attempt();
  assert.equal((await route({ failGuild: true })(input)).status, 500);
  assert.equal(await quantity(), 10);
  assert.equal((await route()(input)).status, 200);
  assert.equal(await quantity(), 10);
});
test("legitimate delta preserves stock already consumed by checkout", async () => {
  await reset(2); assert.equal((await route()(attempt())).status, 200);
  assert.equal(await quantity(), 7);
});

test("the actual edit writer preserves newer inventory on an unrelated content save", async () => {
  const editSource = readFileSync("src/app/dashboard/listings/[id]/edit/page.tsx", "utf8");
  const authoritySql = readFileSync(
    "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
    "utf8",
  );
  assert.match(editSource, /updateListingOwnerContent\(tx,/u);
  assert.doesNotMatch(editSource, /tx\.listing\.update\(/u);
  assert.match(
    authoritySql,
    /next_stock := CASE\s+WHEN p_expected_listing_type <> p_listing_type THEN p_stock_quantity\s+ELSE source_listing\."stockQuantity"\s+END;/u,
  );
  assert.match(authoritySql, /"stockQuantity" = next_stock/u);
});

test("authentication, ownership, missing identity and payload drift cannot mutate stock", async () => {
  await reset(); const input = attempt();
  assert.equal((await route({ authenticated: false })(input)).status, 401);
  assert.equal((await route({ owned: false })(input)).status, 404);
  assert.equal((await route()({ quantity: 10, expectedQuantity: 5 })).status, 400);
  assert.equal(await quantity(), 5);
  assert.equal((await route()(input)).status, 200);
  assert.equal((await route()({ ...input, quantity: 11 })).status, 409);
  assert.equal((await route()({ ...input, issuedAt: input.issuedAt + 1 })).status, 409);
  assert.equal(await quantity(), 10);
});
test("receipt insertion failure rolls back the adjustment and permits a safe retry", async () => {
  await reset(); const input = attempt();
  assert.equal((await route({ rejectReceipt: true })(input)).status, 500);
  assert.equal(await quantity(), 5);
  assert.equal((await route()(input)).status, 200);
  assert.equal(await quantity(), 10);
});
test("unknown expired requests are definitively unapplied; known receipts remain recoverable", async () => {
  await reset(); const old = attempt({ issuedAt: Date.now() - receipts.STOCK_MUTATION_WINDOW_MS });
  const rejected = await route()(old);
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).mutationNotApplied, true);
  assert.equal(await quantity(), 5);
  const input = attempt(); await route()(input);
  await db.transaction(async (connection) => {
    const claim = await receipts.prepareListingStockMutation(port(connection), { listingId: "listing", sellerId: "seller", actorId: "owner" },
      input, { kind: "inventory", quantity: 10, expectedQuantity: 5 }, () => input.issuedAt + 2 * receipts.STOCK_MUTATION_WINDOW_MS);
    assert.equal(claim.replayed, true);
  });
  assert.equal(await quantity(), 10);
});
test("replay never reapplies an adjustment after a later checkout or independent stock change", async () => {
  await reset(); const input = attempt(); await route()(input);
  await db.exec('UPDATE "Listing" SET "stockQuantity"="stockQuantity"-3');
  assert.equal((await route()(input)).status, 200);
  assert.equal(await quantity(), 7);
  await route()(attempt({ quantity: 12, expectedQuantity: 7 }));
  await route()(input);
  assert.equal(await quantity(), 12);
});
test("receipt corruption fails closed without applying another adjustment", async () => {
  await reset(); const input = attempt(); await route()(input);
  await db.exec(`UPDATE "SystemAuditLog" SET metadata = jsonb_set(metadata, '{requestHash}', '"wrong"')`);
  assert.equal((await route()(input)).status, 409);
  assert.equal(await quantity(), 10);
});
test("listing-type receipt prevents replay even after the listing returns to its original type", async () => {
  await reset(); const identity = attempt(); const scope = { listingId: "listing", sellerId: "seller", actorId: "owner" };
  const payload = { kind: "listing-type", previousType: "IN_STOCK", listingType: "MADE_TO_ORDER", stockQuantity: null };
  await db.transaction(async (connection) => {
    const tx = port(connection); const claim = await receipts.prepareListingStockMutation(tx, scope, identity, payload);
    await connection.exec('UPDATE "Listing" SET "listingType"=\'MADE_TO_ORDER\', "stockQuantity"=NULL');
    await receipts.recordListingStockMutation(tx, claim, { listingType: "MADE_TO_ORDER", stockQuantity: null });
  });
  await db.exec('UPDATE "Listing" SET "listingType"=\'IN_STOCK\', "stockQuantity"=2');
  await db.transaction(async (connection) => {
    const tx = port(connection); const claim = await receipts.prepareListingStockMutation(tx, scope, identity, payload);
    assert.equal(claim.replayed, true);
    await assert.rejects(receipts.recordListingStockMutation(tx, claim, {}));
  });
  assert.equal(await quantity(), 2);
  const source = readFileSync("src/app/dashboard/listings/[id]/edit/page.tsx", "utf8");
  assert.match(source, /if \(modeMutation\?\.replayed\) throw new StockMutationConflict/);
  assert.match(source, /locked\.listingType !== stockContext\.listingType/);
  assert.match(source, /recordListingStockMutation\(tx, modeMutation/);
});

test("locked ownership/type rechecks reject a change after the optimistic read", async () => {
  for (const change of ['"sellerId"=\'another-seller\'', '"listingType"=\'MADE_TO_ORDER\'']) {
    await reset();
    const response = await route({ beforeTransaction: () => db.exec(`UPDATE "Listing" SET ${change}`) })(attempt());
    assert.ok([404, 409].includes(response.status)); assert.equal(await quantity(), 5);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "SystemAuditLog"')).rows[0].n, 0);
  }
});
test("freshness is evaluated after the lock and malformed saved outcomes cannot reapply stock", async () => {
  await reset(); const input = attempt(); const tx = port(db);
  let clock = input.issuedAt;
  const lockedQuery = tx.$queryRaw;
  tx.$queryRaw = async (...args) => {
    const rows = await lockedQuery(...args); clock += receipts.STOCK_MUTATION_WINDOW_MS; return rows;
  };
  await assert.rejects(receipts.prepareListingStockMutation(tx,
    { listingId: "listing", sellerId: "seller", actorId: "owner" }, input, {}, () => clock), receipts.StockMutationExpired);
  assert.equal(await quantity(), 5);
  await route()(input);
  await db.exec(`UPDATE "SystemAuditLog" SET metadata = jsonb_set(metadata, '{result}', 'null')`);
  assert.equal((await route()(input)).status, 500); assert.equal(await quantity(), 10);
});
test("replay reuses the co-committed low-stock source and never publishes a draft", async () => {
  await reset(); const input = attempt({ quantity: 2 });
  const first = await route()(input); assert.equal(first.status, 200);
  assert.equal((await first.json()).status, "DRAFT");
  assert.equal((await route()(input)).status, 200);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "SystemAuditLog"')).rows[0].n, 2);
  assert.equal(await quantity(), 2);
});
