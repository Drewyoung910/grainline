import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  ".github/workflows/checkout-stock-reservation-authority-production.yml",
  "utf8",
);
const generic = fs.readFileSync(".github/workflows/production-migrations.yml", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("dedicated runner binds exact main CI and same-commit fresh inspection", () => {
  assert.match(workflow, /permissions:\s*\n\s*actions: read\s*\n\s*contents: read/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /releaseCommit !== context\.sha/);
  assert.match(workflow, /run\.head_sha !== releaseCommit/);
  assert.match(workflow, /name: 'CI'[\s\S]*event: 'push'[\s\S]*headBranch: 'main'/);
  assert.match(
    workflow,
    /name: 'Order Payment Shipping Legacy Inspection'[\s\S]*event: 'workflow_dispatch'[\s\S]*headBranch: 'main'/,
  );
  assert.match(
    workflow,
    /apply-reviewed-checkout-stock-reservation-authority/,
  );
});

test("dedicated runner proves before and after and applies only compatible tree", () => {
  const pre = workflow.indexOf("CHECKOUT_STOCK_RESERVATION_AUTHORITY_SCOPE_STAGE: restart");
  const apply = workflow.indexOf("npx prisma migrate deploy");
  const audit = workflow.indexOf("npm run audit:db-grants -- --require-direct-url");
  const post = workflow.indexOf("CHECKOUT_STOCK_RESERVATION_AUTHORITY_SCOPE_STAGE: after");
  assert.ok(pre >= 0);
  assert.ok(apply > pre);
  assert.ok(audit > apply);
  assert.ok(post > audit);
  assert.match(workflow, /if: steps\.scope\.outputs\.state == 'predecessor'/);
  assert.match(workflow, /\["predecessor", "prepared"\]/);
  assert.match(workflow, /checkout-stock-reservation-authority-reviewed/);
  assert.match(workflow, /audit:rls-stripe-webhook-event-force-sealed-prefix/);
  assert.doesNotMatch(workflow, /enable_checkout_stock_reservation_rls/);
  assert.doesNotMatch(workflow, /force_checkout_stock_reservation_rls/);
  assert.doesNotMatch(workflow, /vercel|deploy application|Stripe endpoint/i);
});

test("generic runner nests activation, source, and authority release boundaries", () => {
  const isolateActivation = generic.indexOf(
    "Isolate the reviewed CheckoutStockReservation activation",
  );
  const isolateSource = generic.indexOf(
    "Isolate the reviewed CheckoutStockReservation source-consistency successor",
  );
  const predecessor = generic.indexOf(
    "Verify exact CheckoutStockReservation authority migration tree after isolation",
  );
  const restoreSource = generic.indexOf(
    "Restore the reviewed CheckoutStockReservation source-consistency successor",
  );
  const restoreActivation = generic.indexOf(
    "Restore the reviewed CheckoutStockReservation activation",
  );
  assert.ok(isolateActivation >= 0);
  assert.ok(isolateSource > isolateActivation);
  assert.ok(predecessor > isolateSource);
  assert.ok(restoreSource > predecessor);
  assert.ok(restoreActivation > restoreSource);
  assert.match(generic, /checkout-stock-reservation-authority-reviewed/);
  assert.match(generic, /checkout-stock-reservation-activation-reviewed/);
});

test("production scope proof has an explicit package entrypoint", () => {
  assert.equal(
    pkg.scripts["audit:rls-checkout-stock-reservation-authority-production-scope"],
    "node scripts/verify-checkout-stock-reservation-authority-production-scope.mjs",
  );
});
