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
    const geoMetro = source("src/lib/geo-metro.ts");

    assert.match(createRoute, /source: "commission_geo_assignment"/);
    assert.match(createRoute, /logServerError\(e, \{/);
    assert.match(createRoute, /extra: \{ commissionRequestId: request\.id \}/);
    assert.doesNotMatch(createRoute, /console\.error\("\[geo-metro\] Failed to assign metro to commission:/);
    assert.match(geoMetro, /source: "geo_metro_find_or_create"/);
    assert.match(geoMetro, /logServerError\(error, \{/);
    assert.match(patchRoute, /source: "commission_status_notification"/);
    assert.match(patchRoute, /commissionRequestId: id/);
    assert.match(interestRoute, /source: "commission_interest_side_effects"/);
    assert.match(interestRoute, /conversationId: result\.conversationId/);
    assert.doesNotMatch(geoMetro, /catch \{\s*return \{ metroId: null, cityMetroId: null \};\s*\}/);
    assert.doesNotMatch(patchRoute, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
    assert.doesNotMatch(interestRoute, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("creates the commission-interest opening message before returning success", () => {
    const interestRoute = source("src/app/api/commission/[id]/interest/route.ts");
    const access = source("src/lib/commissionInterestMessageAccess.ts");
    const transactionStart = access.indexOf("return prisma.$transaction");
    const afterStart = interestRoute.indexOf("after(async () =>");
    const transactionBlock = access.slice(transactionStart);
    const afterBlock = interestRoute.slice(afterStart);

    assert.notEqual(transactionStart, -1);
    assert.notEqual(afterStart, -1);
    assert.match(interestRoute, /createCommissionInterestMessage\(\{/);
    assert.match(transactionBlock, /await tx\.commissionInterest\.create/);
    assert.match(transactionBlock, /await tx\.message\.create/);
    assert.match(transactionBlock, /kind: "commission_interest_card"/);
    assert.match(transactionBlock, /isSystemMessage: true/);
    assert.ok(
      transactionBlock.indexOf("await tx.commissionInterest.create") <
        transactionBlock.indexOf("await tx.message.create"),
      "opening message should be committed with the interest row",
    );
    assert.doesNotMatch(afterBlock, /prisma\.message\.create|tx\.message\.create/);
    assert.match(afterBlock, /createNotification\(/);
  });

  it("does not select unused buyer email data in the interest route", () => {
    const interestRoute = source("src/app/api/commission/[id]/interest/route.ts");

    assert.doesNotMatch(interestRoute, /buyer:\s*\{\s*select:\s*\{[^}]*email/s);
  });
});
