import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const { publicCommissionInterestWhere, resolvedInterestedCount } = await import("../src/lib/commissionInterestCount.ts");

describe("commission interest counts", () => {
  it("prefers the live relation count over a denormalized counter", () => {
    assert.equal(
      resolvedInterestedCount({
        interestedCount: 12,
        _count: { interests: 3 },
      }),
      3,
    );
  });

  it("falls back to the stored count for legacy callers without _count", () => {
    assert.equal(resolvedInterestedCount({ interestedCount: 7 }), 7);
    assert.equal(resolvedInterestedCount({}), 0);
  });

  it("filters public displayed counts to active public seller profiles", () => {
    assert.deepEqual(publicCommissionInterestWhere(), {
      AND: [
        {
          sellerProfile: {
            AND: [
              {
                chargesEnabled: true,
                OR: [{ stripeAccountVersion: null }, { stripeAccountVersion: "v2" }],
                vacationMode: false,
                user: { banned: false, deletedAt: null },
              },
            ],
          },
        },
      ],
    });

    for (const path of [
      "src/app/api/commission/[id]/route.ts",
      "src/app/api/commission/route.ts",
      "src/app/commission/[param]/page.tsx",
      "src/app/commission/page.tsx",
    ]) {
      const routeSource = source(path);
      assert.match(routeSource, /_count: \{ select: \{ interests: \{ where: publicCommissionInterestWhere\(\) \} \} \}/);
      assert.doesNotMatch(routeSource, /_count: \{ select: \{ interests: true \} \}/);
    }

    assert.match(source("src/app/api/commission/[id]/route.ts"), /sellerProfile: activeSellerProfileWhere\(\)/);
  });

  it("keeps Near Me commission interest counts row-local and active-maker filtered", () => {
    const page = source("src/app/commission/page.tsx");
    const nearJoinStart = page.indexOf("LEFT JOIN LATERAL (");
    const nearJoinEnd = page.indexOf(") ci ON true", nearJoinStart);
    const nearJoin = page.slice(nearJoinStart, nearJoinEnd);

    assert.ok(nearJoinStart >= 0 && nearJoinEnd > nearJoinStart);
    assert.match(nearJoin, /WHERE ci\."commissionRequestId" = cr\.id/);
    assert.match(nearJoin, /isp\."chargesEnabled" = true/);
    assert.match(nearJoin, /isp\."stripeAccountVersion" IS NULL OR isp\."stripeAccountVersion" = 'v2'/);
    assert.match(nearJoin, /isp\."vacationMode" = false/);
    assert.match(nearJoin, /iu\.banned = false/);
    assert.match(nearJoin, /iu\."deletedAt" IS NULL/);
    assert.doesNotMatch(page, /LEFT JOIN \(\s*SELECT "commissionRequestId", COUNT\(\*\)::int AS "interestCount"[\s\S]*GROUP BY "commissionRequestId"/);
  });
});
