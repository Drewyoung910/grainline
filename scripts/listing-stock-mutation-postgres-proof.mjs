import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  applyListingStockMutation,
  prepareListingStockMutation,
  recordListingStockMutation,
} from "../src/lib/listingStockMutation.ts";
import { parseInputDraftProofConfig } from "./order-input-correction-drafts-postgres-proof.mjs";
import { proofServerHostAccepted } from "./disposable-postgres-proof-host.mjs";

export function parseStockProofConfig(env = process.env) {
  return parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL:
    env.LISTING_STOCK_MUTATION_PROOF_DATABASE_URL });
}
export function verifyStockProofIdentity(identity, githubActions = false) {
  assert.equal(identity.db, "grainline_ci");
  assert.equal(identity.actor, "ci");
  assert.equal(identity.login, "ci");
  assert.ok(identity.version >= 160000 && identity.version < 170000);
  assert.ok(proofServerHostAccepted(identity.host, githubActions));
}
// Execute the exact stock authorities shipped by the Listing preparation
// migration, rewritten only into this proof's disposable schema.
export function loadStockAuthorityDefinitions(schema = "listing_stock_proof_fixture") {
  assert.match(schema, /^listing_stock_proof_[a-z0-9_]+$/u);
  const migration = readFileSync(
    "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
    "utf8",
  );
  const names = ["lock", "apply"];
  return names.map((name) => {
    const marker = `grainline_listing_owner_stock_${name}`;
    const match = migration.match(new RegExp(
      `CREATE FUNCTION public\\.${marker}\\([\\s\\S]*?\\$${marker}\\$;`,
      "u",
    ));
    assert.ok(match, `missing ${marker} migration definition`);
    return match[0].replaceAll("public.", `"${schema}".`);
  }).join("\n");
}
function port(client, schema) {
  return {
    $queryRaw: async (parts, ...values) => {
      const sql = parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "")
        .replaceAll("public.grainline_listing_owner_stock_", `"${schema}".grainline_listing_owner_stock_`);
      return (await client.query(sql, values)).rows;
    },
    systemAuditLog: {
      findUnique: async ({ where }) => (await client.query('SELECT * FROM "SystemAuditLog" WHERE id=$1', [where.id])).rows[0] ?? null,
      create: async ({ data }) => {
        await client.query('INSERT INTO "SystemAuditLog" VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [data.id, data.actorType, data.actorId, data.action, data.targetType, data.targetId, JSON.stringify(data.metadata)]);
        return { id: data.id };
      },
    },
  };
}
async function waitUntilBlocked(observer, waitingPid, blockingPid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows: [state] } = await observer.query('SELECT $1::int = ANY(pg_catalog.pg_blocking_pids($2::int)) AS blocked',
      [blockingPid, waitingPid]);
    if (state.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("second writer did not wait on the first listing lock");
}

export async function runStockMutationPostgresProof(env = process.env, onPhase = () => {}) {
  const { databaseUrl } = parseStockProofConfig(env);
  const schema = `listing_stock_proof_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^listing_stock_proof_[a-f0-9]{32}$/);
  const clients = [0, 1, 2].map(() => new pg.Client({ connectionString: databaseUrl,
    connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 20000 }));
  const connected = []; let created = false;
  const [a, b, observer] = clients;
  try {
    onPhase("identity");
    for (const client of clients) {
      await client.connect(); connected.push(client);
      const { rows: [identity] } = await client.query(`SELECT current_database() AS db,
        CURRENT_USER AS actor, SESSION_USER AS login,
        current_setting('server_version_num')::int AS version,
        pg_catalog.host(pg_catalog.inet_server_addr()) AS host, pg_backend_pid() AS pid`);
      verifyStockProofIdentity(identity, env.GITHUB_ACTIONS === "true");
      client.proofPid = identity.pid;
    }
    onPhase("isolated-fixture");
    await observer.query(`CREATE SCHEMA "${schema}"`); created = true;
    for (const client of clients) {
      await client.query(`SET search_path TO "${schema}", pg_catalog`);
      await client.query("SET lock_timeout = '10s'");
    }
    await observer.query(`CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE','SOLD_OUT','DRAFT');
      CREATE TABLE "User" (id text PRIMARY KEY, banned boolean NOT NULL DEFAULT false,
        "deletedAt" timestamp);
      CREATE TABLE "SellerProfile" (id text PRIMARY KEY, "userId" text NOT NULL,
        "ownerAccountActive" boolean NOT NULL DEFAULT true);
      CREATE TABLE "Listing" (id text PRIMARY KEY, "sellerId" text, title text,
        "stockQuantity" integer, status "ListingStatus", "isPrivate" boolean DEFAULT false,
        "listingType" text DEFAULT 'IN_STOCK', "rejectionReason" text, "archivedAt" timestamp,
        "updatedAt" timestamp DEFAULT now());
      CREATE TABLE "SystemAuditLog" (id text PRIMARY KEY, "actorType" text, "actorId" text,
        action text, "targetType" text, "targetId" text, metadata jsonb)`);
    await observer.query(loadStockAuthorityDefinitions(schema));
    const scope = { listingId: "listing", sellerId: "seller", actorId: "owner" };
    const input = () => ({ mutationId: randomUUID(), issuedAt: Date.now() });
    const payload = { kind: "inventory", quantity: 10, expectedQuantity: 5 };
    async function reset() {
      await observer.query('TRUNCATE "User", "SellerProfile", "Listing", "SystemAuditLog"');
      await observer.query(`INSERT INTO "User" (id) VALUES ('owner');
        INSERT INTO "SellerProfile" (id,"userId") VALUES ('seller','owner');
        INSERT INTO "Listing" (id,"sellerId",title,"stockQuantity",status)
          VALUES ('listing','seller','Synthetic piece',5,'ACTIVE')`);
    }
    async function apply(client, identity) {
      await client.query("SELECT pg_catalog.set_config('app.user_id','owner',true)");
      const tx = port(client, schema);
      const claim = await prepareListingStockMutation(tx, scope, identity, payload);
      assert.ok(claim);
      if (!claim.replayed) {
        const updated = await applyListingStockMutation(tx, {
          listingId: "listing",
          sellerId: "seller",
          applyDelta: true,
          stockDelta: 5,
          quantity: 10,
        });
        assert.ok(updated);
        await recordListingStockMutation(tx, claim, { updated });
      }
      return claim.replayed;
    }
    async function state(expected, receipts) {
      assert.deepEqual((await observer.query(`SELECT (SELECT "stockQuantity" FROM "Listing") AS quantity,
        (SELECT count(*)::int FROM "SystemAuditLog") AS receipts`)).rows[0], { quantity: expected, receipts });
    }
    for (const rollbackFirst of [false, true]) {
      onPhase(rollbackFirst ? "rollback-and-retry" : "concurrent-exact-retry");
      await reset(); const identity = input();
      await a.query("BEGIN"); assert.equal(await apply(a, identity), false);
      await b.query("BEGIN");
      const waiting = apply(b, identity); void waiting.catch(() => {});
      await waitUntilBlocked(observer, b.proofPid, a.proofPid);
      await a.query(rollbackFirst ? "ROLLBACK" : "COMMIT");
      assert.equal(await waiting, !rollbackFirst); await b.query("COMMIT");
      await state(10, 1);
    }
    for (const checkoutFirst of [true, false]) {
      onPhase(checkoutFirst ? "checkout-before-adjustment" : "adjustment-before-checkout");
      await reset(); await a.query("BEGIN"); await b.query("BEGIN");
      const checkout = (client) => client.query('UPDATE "Listing" SET "stockQuantity"="stockQuantity"-2 WHERE id=$1', ["listing"]);
      if (checkoutFirst) await checkout(a); else await apply(a, input());
      const waiting = checkoutFirst ? apply(b, input()) : checkout(b); void waiting.catch(() => {});
      await waitUntilBlocked(observer, b.proofPid, a.proofPid);
      await a.query("COMMIT"); await waiting; await b.query("COMMIT");
      await state(8, 1);
    }
    onPhase("independent-adjustments");
    await reset(); await a.query("BEGIN"); await b.query("BEGIN");
    await apply(a, input()); const waiting = apply(b, input()); void waiting.catch(() => {});
    await waitUntilBlocked(observer, b.proofPid, a.proofPid);
    await a.query("COMMIT"); assert.equal(await waiting, false); await b.query("COMMIT");
    await state(15, 2);
    return { status: "passed", concurrentSchedules: 5, actualStockAuthorities: true,
      scope: "isolated-native-lock-fixture-not-full-runtime-or-provider-acceptance" };
  } finally {
    // Cleanup touches only this newly created, validated CI-only schema. There
    // are no migrations, role/grant changes, or public-table fixture writes.
    try {
      for (const client of connected) await client.query("ROLLBACK");
      if (created) {
        await observer.query(`DROP SCHEMA "${schema}" CASCADE`);
        assert.equal((await observer.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1', [schema])).rows[0].n, 0);
      }
    } finally { await Promise.all(connected.map((client) => client.end())); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration";
  try { process.stdout.write(`${JSON.stringify(await runStockMutationPostgresProof(process.env, (value) => { phase = value; }))}\n`); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable listing stock proof failed closed at ${phase} [${code}].\n`);
    process.exitCode = 1;
  }
}
