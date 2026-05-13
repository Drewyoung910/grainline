import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("commission route observability follow-ups", () => {
  it("captures non-blocking commission side-effect failures with safe identifiers", () => {
    const createRoute = source("src/app/api/commission/route.ts");
    const patchRoute = source("src/app/api/commission/[id]/route.ts");
    const interestRoute = source("src/app/api/commission/[id]/interest/route.ts");

    assert.match(createRoute, /source: "commission_geo_assignment"/);
    assert.match(createRoute, /extra: \{ commissionRequestId: request\.id \}/);
    assert.match(patchRoute, /source: "commission_status_notification"/);
    assert.match(patchRoute, /commissionRequestId: id/);
    assert.match(interestRoute, /source: "commission_interest_side_effects"/);
    assert.match(interestRoute, /conversationId: finalConversationId/);
    assert.doesNotMatch(patchRoute, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
    assert.doesNotMatch(interestRoute, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("does not select unused buyer email data in the interest route", () => {
    const interestRoute = source("src/app/api/commission/[id]/interest/route.ts");

    assert.doesNotMatch(interestRoute, /buyer:\s*\{\s*select:\s*\{[^}]*email/s);
  });
});
