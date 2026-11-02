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
    const commissionAccess = source("src/lib/commissionRequestAccess.ts");
    const geoMetro = source("src/lib/geo-metro.ts");

    assert.match(createRoute, /source: "commission_geo_assignment"/);
    assert.match(createRoute, /logServerError\(e, \{/);
    assert.match(createRoute, /extra: \{ commissionRequestId: request\.id \}/);
    assert.doesNotMatch(createRoute, /console\.error\("\[geo-metro\] Failed to assign metro to commission:/);
    assert.match(geoMetro, /source: "geo_metro_find_or_create"/);
    assert.match(geoMetro, /logServerError\(error, \{/);
    assert.match(patchRoute, /transitionOwnerCommissionRequest/);
    assert.match(commissionAccess, /createNotificationOrThrow\(\{/);
    assert.match(commissionAccess, /sourceType: NOTIFICATION_SOURCE_TYPES\.COMMISSION_REQUEST/);
    assert.match(interestRoute, /source: "commission_interest_side_effects"/);
    assert.match(interestRoute, /conversationId: result\.conversationId/);
    assert.doesNotMatch(geoMetro, /catch \{\s*return \{ metroId: null, cityMetroId: null \};\s*\}/);
    assert.doesNotMatch(patchRoute, /after\(async \(\) =>/);
    assert.doesNotMatch(interestRoute, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("creates the commission-interest opening message before returning success", () => {
    const interestRoute = source("src/app/api/commission/[id]/interest/route.ts");
    const access = source("src/lib/commissionInterestMessageAccess.ts");
    const authority = source("src/lib/conversationMessageAuthority.ts");
    const serviceSql = source("docs/rls-drafts/conversation-message-service-authority.sql");
    const commissionFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_create_commission_interest"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_order_ready"),
    );
    const afterStart = interestRoute.indexOf("after(async () =>");
    const afterBlock = interestRoute.slice(afterStart);

    assert.notEqual(afterStart, -1);
    assert.match(interestRoute, /createCommissionInterestMessage\(\{/);
    assert.match(access, /createActorCommissionInterest\(input, client\)/);
    assert.match(authority, /public\.grainline_commission_interest_actor_create/);
    assert.match(commissionFunction, /INSERT INTO public\."CommissionInterest"/);
    assert.match(commissionFunction, /INSERT INTO public\."Message"/);
    assert.match(commissionFunction, /'commission_interest_card',\s*true/);
    assert.ok(
      commissionFunction.indexOf('INSERT INTO public."CommissionInterest"') <
        commissionFunction.indexOf('INSERT INTO public."Message"'),
      "opening message should be committed with the interest row",
    );
    assert.match(commissionFunction, /UPDATE public\."CommissionRequest"/);
    assert.doesNotMatch(access, /prisma\.\$transaction|tx\.message\.create/);
    assert.doesNotMatch(afterBlock, /prisma\.message\.create|tx\.message\.create/);
    assert.match(afterBlock, /createNotification\(/);
  });

  it("does not select unused buyer email data in the interest route", () => {
    const interestRoute = source("src/app/api/commission/[id]/interest/route.ts");

    assert.doesNotMatch(interestRoute, /buyer:\s*\{\s*select:\s*\{[^}]*email/s);
  });

  it("consumes commission mutation limits only after cheap eligibility checks", () => {
    const createRoute = source("src/app/api/commission/route.ts");
    const interestRoute = source("src/app/api/commission/[id]/interest/route.ts");

    assert.ok(
      createRoute.indexOf("CommissionCreateSchema.parse") <
        createRoute.indexOf("safeRateLimit(\n    commissionCreateRatelimit"),
      "invalid commission bodies must not consume the daily create limit",
    );
    assert.ok(
      createRoute.indexOf("filterVerifiedFirstPartyMediaUrlsForUser") <
        createRoute.indexOf("safeRateLimit(\n    commissionCreateRatelimit"),
      "unowned reference media must not consume the daily create limit",
    );
    assert.ok(
      createRoute.indexOf("safeRateLimit(\n    commissionCreateRatelimit") <
        createRoute.indexOf("const request = await createOwnerCommissionRequest"),
      "the accepted write must remain rate-limited",
    );
    assert.ok(
      interestRoute.indexOf("commissionRequest.isOwner") <
        interestRoute.indexOf("safeRateLimit(\n    commissionInterestRatelimit"),
      "ineligible self-interest must not consume the maker's daily limit",
    );
    assert.ok(
      interestRoute.indexOf("safeRateLimit(\n    commissionInterestRatelimit") <
        interestRoute.indexOf("const result = await createCommissionInterestMessage"),
      "accepted interest creation must remain rate-limited",
    );
  });

  it("describes local scope as a preference rather than an access promise", () => {
    const page = source("src/app/commission/new/page.tsx");

    assert.match(page, /Prefer nearby makers/);
    assert.match(page, /makers elsewhere can still see and respond/);
    assert.doesNotMatch(page, /Local makers only|shows your request to makers within/);
  });
});
