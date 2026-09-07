import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import yaml from "js-yaml";
import { proofConfig } from "../scripts/order-paid-repair-lock-postgres-proof.mjs";

const draft = fs.readFileSync(
  "docs/rls-drafts/order-paid-checkout-authority.sql",
  "utf8",
);
const migration = fs.readFileSync(
  "prisma/migrations/20260905130000_prepare_order_paid_checkout_authority/migration.sql",
  "utf8",
);
const predecessor = fs.readFileSync(
  "prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql",
  "utf8",
);
const workflowSource = fs.readFileSync(
  ".github/workflows/order-paid-repair-lock-proof.yml",
  "utf8",
);

function functionSql(source, name) {
  const start = source.indexOf(`CREATE FUNCTION public.${name}(`);
  const endTag = `$${name}$;`;
  const end = source.indexOf(endTag, start);
  assert.ok(start >= 0 && end > start, `missing ${name}`);
  return source.slice(start, end + endTag.length);
}

function assertOrder(source, fragments) {
  let prior = -1;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, prior + 1);
    assert.ok(index > prior, `${JSON.stringify(fragment)} is out of order`);
    prior = index;
  }
}

describe("Order paid-checkout/repair lock proof", () => {
  it("admits only its exact disposable loopback database identity", () => {
    const accepted =
      "postgresql://paid_lock_owner:synthetic@127.0.0.1:5432/grainline_paid_lock_proof";
    assert.equal(proofConfig({
      ORDER_PAID_REPAIR_PROOF_DATABASE_URL: accepted,
    }).connectionString, accepted);

    for (const rejected of [
      undefined,
      "postgres://paid_lock_owner@127.0.0.1:5432/grainline_paid_lock_proof",
      "postgresql://paid_lock_owner@localhost:5432/grainline_paid_lock_proof",
      "postgresql://other@127.0.0.1:5432/grainline_paid_lock_proof",
      "postgresql://paid_lock_owner@127.0.0.1:5432/other",
      "postgresql://paid_lock_owner@127.0.0.1:5432/grainline_paid_lock_proof?sslmode=disable",
    ]) {
      assert.throws(
        () => proofConfig({
          ORDER_PAID_REPAIR_PROOF_DATABASE_URL: rejected,
        }),
      );
    }
  });

  it("pins one event, Session advisory, reservation lock order across real functions", () => {
    assert.deepEqual(Buffer.from(draft), Buffer.from(migration));
    assertOrder(functionSql(draft, "grainline_stripe_checkout_order_create"), [
      'FROM public."StripeWebhookEvent" AS event',
      "pg_catalog.pg_advisory_xact_lock(",
      'FROM public."CheckoutStockReservation" AS reservation',
    ]);
    assertOrder(functionSql(predecessor, "grainline_checkout_reservation_complete"), [
      'FROM public."StripeWebhookEvent" AS event',
      "pg_catalog.pg_advisory_xact_lock(913337",
      'FROM public."CheckoutStockReservation" AS reservation',
    ]);
    assertOrder(functionSql(predecessor, "grainline_checkout_reservation_repair_finalize"), [
      'FROM public."CheckoutStockReservation" AS reservation',
      "pg_catalog.pg_advisory_xact_lock(913337",
      'INTO STRICT source_reservation\n    FROM public."CheckoutStockReservation"',
    ]);
  });

  it("runs the real three-connection proof in an isolated PostgreSQL 16 job", () => {
    const workflow = yaml.load(workflowSource);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.doesNotMatch(workflowSource, /workflow_dispatch/u);
    const job = workflow.jobs["postgres-lock-order"];
    assert.equal(job.services.postgres.image, "postgres:16");
    assert.equal(
      job.services.postgres.env.POSTGRES_USER,
      "paid_lock_owner",
    );
    assert.equal(
      job.services.postgres.env.POSTGRES_DB,
      "grainline_paid_lock_proof",
    );
    const serialized = JSON.stringify(job.steps);
    assert.match(serialized, /order-paid-repair-lock-proof\.test\.mjs/u);
    assert.match(serialized, /audit:order-paid-repair-lock-postgres/u);
    assert.match(
      serialized,
      /127\.0\.0\.1:5432\/grainline_paid_lock_proof/u,
    );
    assert.doesNotMatch(workflowSource, /secrets\.|env\.DIRECT_URL/u);
  });
});
