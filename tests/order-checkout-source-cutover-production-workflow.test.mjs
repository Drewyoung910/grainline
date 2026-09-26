import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-checkout-source-cutover-production.yml",
  "utf8",
);
const migration =
  "prisma/migrations/20260926012300_retire_legacy_checkout_reservation_creators/migration.sql";
const digest =
  "6bd4f7d1261efd04a8dc003161f8b728483ab9437a99677355b9c6a7e0fb9924";

test("cutover workflow binds one migration to exact main, CI and correction acceptance", () => {
  assert.match(
    workflow,
    /^name: Order checkout source cutover \(protected\)$/mu,
  );
  assert.match(workflow, /^  workflow_dispatch:$/mu);
  assert.match(workflow, /github\.repository == 'Drewyoung910\/grainline'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(workflow, /retire-legacy-checkout-and-drain/u);
  assert.match(workflow, /ci\.name !== 'CI'/u);
  assert.match(
    workflow,
    /corrections\.name !== 'Order Release Corrections Production'/u,
  );
  assert.match(workflow, /corrections\.head_sha !== sha/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /id: cutover_scope/u);
  assert.match(workflow, /state=\$\{cutoverRow \? 'restart' : 'predecessor'\}/u);
  assert.match(
    workflow,
    /if: steps\.cutover_scope\.outputs\.state == 'predecessor'/u,
  );
  assert.match(workflow, /\[\[ "\$CUTOVER_STATE" == "restart" \]\]/u);
  assert.match(workflow, /trap restore_cutover EXIT/u);
  assert.match(workflow, /assert\.equal\(cutoverRow\.checksum, cutoverDigest\)/u);
});

test("cutover workflow pins bytes, preserves snapshot calls and proves the full legacy drain", () => {
  const bytes = readFileSync(migration);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), digest);
  assert.match(workflow, new RegExp(digest, "u"));
  assert.match(workflow, /sleep 2820/u);
  assert.match(workflow, /active_legacy: 0/u);
  assert.match(workflow, /legacy_created_after_cutover: 0/u);
  assert.match(workflow, /unexpired_legacy: 0/u);
  assert.match(
    workflow,
    /grainline_checkout_reservation_create_cart_snapshot/u,
  );
  assert.match(
    workflow,
    /grainline_checkout_reservation_create_single_snapshot/u,
  );
  const apply = workflow.indexOf("Apply only legacy checkout creator retirement");
  const audit = workflow.indexOf(
    "Audit post-cutover runtime grants and global RLS catalog",
  );
  const drain = workflow.indexOf(
    "Keep predecessor live while the 31-minute checkout window and repair cadence drain",
  );
  assert.ok(apply >= 0);
  assert.ok(audit > apply);
  assert.ok(drain > audit);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(
    workflow,
    /vercel|alias|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|ALTER TABLE[^\n]+DISABLE ROW LEVEL SECURITY/iu,
  );
});
