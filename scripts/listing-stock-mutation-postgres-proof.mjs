import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import ts from "typescript";
import { prepareListingStockMutation, recordListingStockMutation } from "../src/lib/listingStockMutation.ts";
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
// Execute the production tagged stock UPDATE, not a separately maintained copy
// of its delta/status algorithm. The route behavior is covered separately by the
// actual-handler PGlite tests; this fixture isolates native row-lock behavior.
export function loadStockUpdate() {
  const source = ts.createSourceFile("stock.ts", readFileSync("src/app/api/listings/[id]/stock/route.ts", "utf8"),
    ts.ScriptTarget.Latest, true);
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "updatedRows") {
      assert.ok(ts.isAwaitExpression(node.initializer));
      const tagged = node.initializer.expression;
      assert.ok(ts.isTaggedTemplateExpression(tagged));
      assert.equal(tagged.tag.getText(source), "tx.$queryRaw");
      matches.push(tagged.template.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.equal(matches.length, 1);
  return new Function("tx", "id", "listing", "applyDelta", "stockDelta", "quantity",
    `return tx.$queryRaw${matches[0]};`);
}
function port(client) {
  return {
    $queryRaw: async (parts, ...values) => (await client.query(parts.reduce((sql, part, index) =>
      sql + (index ? `$${index}` : "") + part, ""), values)).rows,
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
      CREATE TABLE "Listing" (id text PRIMARY KEY, "sellerId" text, title text,
        "stockQuantity" integer, status "ListingStatus", "isPrivate" boolean DEFAULT false,
        "listingType" text DEFAULT 'IN_STOCK', "rejectionReason" text, "updatedAt" timestamp DEFAULT now());
      CREATE TABLE "SystemAuditLog" (id text PRIMARY KEY, "actorType" text, "actorId" text,
        action text, "targetType" text, "targetId" text, metadata jsonb)`);
    const update = loadStockUpdate();
    const scope = { listingId: "listing", sellerId: "seller", actorId: "owner" };
    const input = () => ({ mutationId: randomUUID(), issuedAt: Date.now() });
    const payload = { kind: "inventory", quantity: 10, expectedQuantity: 5 };
    async function reset() {
      await observer.query('TRUNCATE "Listing", "SystemAuditLog"');
      await observer.query(`INSERT INTO "Listing" (id,"sellerId",title,"stockQuantity",status)
        VALUES ('listing','seller','Synthetic piece',5,'ACTIVE')`);
    }
    async function apply(client, identity) {
      const tx = port(client);
      const claim = await prepareListingStockMutation(tx, scope, identity, payload);
      assert.ok(claim);
      if (!claim.replayed) {
        const [updated] = await update(tx, "listing", { seller: { id: "seller" } }, true, 5, 10);
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
    return { status: "passed", concurrentSchedules: 5, actualStockUpdate: true,
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
