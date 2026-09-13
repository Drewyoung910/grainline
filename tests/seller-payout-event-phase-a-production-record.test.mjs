import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const RELEASE = "bf9f353ed1d94f4d32933b5d6417a75f4c0f625e";
const MAIN_CI = "32663849012";
const MIGRATION_RUN = "32667518275";
const EVIDENCE_SHA256 =
  "01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de";

const read = (pathname) => fs.readFileSync(pathname, "utf8");
const architecture = read("docs/architecture.md");
const matrix = read("docs/rls-coverage-matrix.md");
const runbook = read("docs/runbook.md");
const strategy = read("STRATEGY.md");
const audit = read("docs/security-audit-log.md");
const release = read("docs/seller-payout-event-activation-release.md");
const wiring = read("docs/seller-payout-event-activation-production-wiring.md");

test("SellerPayoutEvent Phase-A records retain the exact accepted evidence", () => {
  for (const document of [architecture, matrix, runbook, strategy, audit, release, wiring]) {
    assert.match(document, new RegExp(RELEASE));
    assert.match(document, new RegExp(MAIN_CI));
    assert.match(document, new RegExp(MIGRATION_RUN));
    assert.match(document, new RegExp(EVIDENCE_SHA256));
  }
});

test("SellerPayoutEvent retains Phase A proof after FORCE acceptance", () => {
  assert.match(
    matrix,
    /`SellerPayoutEvent` \| `RLS_LIVE_FORCE`/u,
  );
  assert.match(architecture, /SellerPayoutEvent Phase A remains accepted/u);
  assert.match(release, /Status: accepted production policyless Phase A/u);
  assert.match(wiring, /Status: accepted production Phase A/u);
  assert.match(
    strategy,
    /posture-only FORCE successor was applied[\s\S]*SellerPayoutEvent FORCE is accepted/u,
  );
  assert.match(audit, /SellerPayoutEvent policyless Phase A accepted in production/u);
  assert.match(matrix, /01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de/u);
});
