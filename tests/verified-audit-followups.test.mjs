import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function tsSourceFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const path = `${dir}/${entry}`;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (["node_modules", ".next", ".git"].includes(entry)) continue;
      files.push(...tsSourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

describe("verified audit follow-up guardrails", () => {
  it("validates new message recipients and listing context before creating a conversation", () => {
    const text = source("src/app/messages/new/page.tsx");
    assert.match(text, /canStartConversationWith/);
    assert.match(text, /canAttachConversationContextListing/);
    assert.match(text, /prisma\.block\.findFirst/);
    assert.equal(text.includes("contextListingId: listing"), false);
  });

  it("keeps commission close and interest creation behind atomic open-state predicates", () => {
    const patchRoute = source("src/app/api/commission/[id]/route.ts");
    const interestRoute = source("src/app/api/commission/[id]/interest/route.ts");
    assert.match(patchRoute, /commissionRequest\.updateMany/);
    assert.match(patchRoute, /openCommissionMutationWhere\(id, new Date\(\), \{ buyerId: me\.id \}\)/);
    assert.match(interestRoute, /commissionRequest\.updateMany/);
    assert.match(interestRoute, /COMMISSION_CLOSED_DURING_INTEREST/);
  });

  it("keeps order total displays and emails on the gift-wrap-aware helper", () => {
    const paths = [
      "src/app/account/page.tsx",
      "src/app/account/orders/page.tsx",
      "src/app/dashboard/orders/page.tsx",
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
      "src/app/admin/orders/page.tsx",
      "src/app/admin/orders/[id]/page.tsx",
      "src/app/admin/flagged/page.tsx",
      "src/app/admin/cases/[id]/page.tsx",
      "src/app/dashboard/analytics/page.tsx",
      "src/lib/email.ts",
    ];

    for (const path of paths) {
      assert.match(source(path), /orderTotalCents/, `${path} should use orderTotalCents()`);
    }
    assert.match(source("src/app/api/seller/analytics/recent-sales/route.ts"), /giftWrappingPriceCents: true/);
    assert.match(source("src/app/api/stripe/webhook/route.ts"), /giftWrappingPriceCents: order\.giftWrappingPriceCents/);
  });

  it("allows post-delivery case creation without offering not-received reasons", () => {
    const page = source("src/app/dashboard/orders/[id]/page.tsx");
    const form = source("src/components/OpenCaseForm.tsx");
    assert.match(page, /isTerminal \|\| \(order\.estimatedDeliveryDate/);
    assert.match(page, /allowNotReceived=\{!isTerminal\}/);
    assert.match(form, /allowNotReceived \|\| value !== "NOT_RECEIVED"/);
    assert.match(form, /useState\(allowNotReceived \? "NOT_RECEIVED" : "DAMAGED"\)/);
  });

  it("documents the current Stripe API version pin", () => {
    assert.match(source("src/lib/stripe.ts"), /apiVersion: "2025-10-29\.clover"/);
    assert.match(source("CLAUDE.md"), /pins `"2025-10-29\.clover"` explicitly/);
  });

  it("keeps runtime security docs aligned with current Next and header config", () => {
    const lock = JSON.parse(source("package-lock.json"));
    const resolvedNext = lock.packages?.["node_modules/next"]?.version;
    assert.equal(resolvedNext, "16.2.6");
    assert.match(source("CLAUDE.md"), /Next\.js 16\.2\.6/);
    assert.doesNotMatch(source("CLAUDE.md"), /Next\.js 16\.2\.4/);

    assert.match(source("next.config.ts"), /Cross-Origin-Opener-Policy", value: "same-origin-allow-popups"/);
    assert.match(source("CLAUDE.md"), /`Cross-Origin-Opener-Policy` \| `same-origin-allow-popups`/);
  });

  it("keeps terms acceptance enforced server-side instead of only in the signup form", () => {
    const middleware = source("src/middleware.ts");
    assert.match(middleware, /isTermsAcceptanceAllowed/);
    assert.match(middleware, /termsAcceptedAt: true/);
    assert.match(middleware, /termsVersion: true/);
    assert.match(middleware, /ageAttestedAt: true/);
    assert.match(middleware, /shouldRequireTermsAcceptance\(account\)/);
    assert.match(middleware, /new URL\("\/accept-terms"/);

    const acceptRoute = source("src/app/api/account/accept-terms/route.ts");
    assert.match(acceptRoute, /termsAccepted: z\.literal\(true\)/);
    assert.match(acceptRoute, /ageAttested: z\.literal\(true\)/);
    assert.match(acceptRoute, /termsVersion: z\.literal\(CURRENT_TERMS_VERSION\)/);
    assert.match(acceptRoute, /currentTermsAcceptanceUpdate\(me, acceptedAt\)/);

    const acceptForm = source("src/app/accept-terms/AcceptTermsForm.tsx");
    assert.match(acceptForm, /fetch\("\/api\/account\/accept-terms"/);
    assert.match(acceptForm, /window\.location\.assign\(redirectUrl\)/);
  });

  it("keeps Stripe setup reachable from the final onboarding summary", () => {
    const wizard = source("src/app/dashboard/onboarding/OnboardingWizard.tsx");
    assert.match(wizard, /Connect Stripe Payouts/);
    assert.match(wizard, /onClick=\{handleConnectStripe\}/);
    assert.match(wizard, /body: JSON\.stringify\(\{ returnUrl: "\/dashboard\/onboarding\?stripe_return=1" \}\)/);
    assert.match(wizard, /disabled=\{loading \|\| !stripeReady \|\| listingCount < 1\}/);
    assert.doesNotMatch(wizard, /bg-stone-50/);
    assert.match(wizard, /className="card-section p-8/);
    assert.match(wizard, /font-display/);
  });

  it("keeps disconnected sellers from losing new-listing form data on publish", () => {
    const page = source("src/app/dashboard/listings/new/page.tsx");
    assert.match(page, /PUBLISH_REQUIRES_STRIPE_MESSAGE/);
    assert.match(page, /return \{ ok: false, error: PUBLISH_REQUIRES_STRIPE_MESSAGE \}/);
    assert.doesNotMatch(page, /redirect\("\/dashboard\/listings\/new\?error=stripe"\)/);
    assert.match(page, /disabled=\{!chargesEnabled\}/);
    assert.match(page, /Save as Draft/);
  });

  it("marks label-cost clawback failures for durable admin reconciliation", () => {
    const labelRoute = source("src/app/api/orders/[id]/label/route.ts");
    assert.match(labelRoute, /markLabelClawbackForReview/);
    assert.match(labelRoute, /reason: "missing_transfer"/);
    assert.match(labelRoute, /reason: "stripe_reversal_failed"/);
    assert.match(labelRoute, /reviewNeeded: true/);
    assert.match(source("src/lib/labelClawbackState.ts"), /Staff must retry or manually reconcile/);
  });

  it("keeps public middleware scoped to actual public seller and cron-auth surfaces", () => {
    const middleware = source("src/middleware.ts");
    assert.match(middleware, /"\/seller\/\(\(\?!payouts\|map\)\[\^\/\]\+\)"/);
    assert.match(middleware, /"\/seller\/\(\(\?!payouts\|map\)\[\^\/\]\+\)\/shop\(\.\*\)"/);
    assert.match(middleware, /"\/api\/seller\/\(\[\^\/\]\+\)\/view"/);
    assert.match(middleware, /"\/api\/cases\/\(\[\^\/\]\+\)\/escalate"/);
    assert.match(middleware, /\/\^\\\/api\\\/cases\\\/\[\^\/\]\+\\\/escalate\$\/\.test\(pathname\)/);
    assert.doesNotMatch(middleware, /"\/seller\(\.\*\)"/);
  });

  it("keeps stale public links and singular routes from returning dead pages", () => {
    assert.match(source("src/app/account/following/page.tsx"), /href="\/map"/);
    assert.doesNotMatch(source("src/app/account/following/page.tsx"), /href="\/sellers"/);
    assert.match(source("src/app/dashboard/analytics/page.tsx"), /href="\/dashboard\/inventory"/);
    assert.match(source("src/app/seller/map/page.tsx"), /redirect\("\/map"\)/);
    assert.match(source("src/app/seller/payouts/page.tsx"), /redirect\("\/dashboard\/seller"\)/);
    assert.match(source("src/app/api/stripe/connect/create/route.ts"), /new URL\("\/dashboard\/seller"/);
    assert.doesNotMatch(source("src/app/api/stripe/connect/create/route.ts"), /\/seller\/payouts/);
  });

  it("keeps global blog search suggestions on the public blog visibility predicate", () => {
    const text = source("src/app/api/search/suggestions/route.ts");
    assert.match(text, /LEFT JOIN "SellerProfile" sp ON sp\.id = bp\."sellerProfileId"/);
    assert.match(text, /LEFT JOIN "User" seller_user ON seller_user\.id = sp\."userId"/);
    assert.match(text, /sp\."chargesEnabled" = true/);
    assert.match(text, /sp\."vacationMode" = false/);
    assert.match(text, /sp\."stripeAccountVersion" IS NULL OR sp\."stripeAccountVersion" = 'v2'/);
    assert.match(text, /seller_user\.banned = false/);
    assert.match(text, /bp\."sellerProfileId" != ALL\(\$\{blockedSellerIds\}\)/);
  });

  it("keeps public marketplace surfaces on shared visibility predicates", () => {
    const publicSurfacePaths = [
      "src/app/page.tsx",
      "src/app/about/page.tsx",
      "src/app/browse/[metroSlug]/page.tsx",
      "src/app/browse/[metroSlug]/[category]/page.tsx",
      "src/app/makers/[metroSlug]/page.tsx",
      "src/app/map/page.tsx",
      "src/app/sellers/map/page.tsx",
      "src/app/layout.tsx",
      "src/app/sitemap.ts",
      "src/app/why-grainline/page.tsx",
    ];
    for (const path of publicSurfacePaths) {
      const text = source(path);
      assert.doesNotMatch(text, /chargesEnabled: true,\s*vacationMode: false,\s*user: \{ banned: false, deletedAt: null \}/, `${path} should use seller visibility helpers`);
      assert.doesNotMatch(text, /seller: \{ vacationMode: false, chargesEnabled: true/, `${path} should use listing visibility helpers`);
    }

    const rawSqlPaths = [
      "src/app/page.tsx",
      "src/app/blog/page.tsx",
      "src/app/api/blog/search/route.ts",
      "src/app/api/blog/search/suggestions/route.ts",
      "src/app/api/listings/[id]/similar/route.ts",
      "src/app/api/search/suggestions/route.ts",
      "src/lib/popularTags.ts",
      "src/lib/popularBlogTags.ts",
      "src/lib/site-metrics-snapshot.ts",
      "src/lib/quality-score.ts",
    ];
    for (const path of rawSqlPaths) {
      assert.match(source(path), /sp\."stripeAccountVersion" IS NULL OR sp\."stripeAccountVersion" = 'v2'/, `${path} should keep legacy-null/v2 visibility`);
    }
    assert.doesNotMatch(source("src/app/page.tsx"), /featuredMakerWhere/);
    assert.match(source("src/lib/conversationStartState.ts"), /listing\.seller\.stripeAccountVersion == null \|\| listing\.seller\.stripeAccountVersion === "v2"/);
    assert.match(source("src/app/messages/new/page.tsx"), /stripeAccountVersion: true/);
  });

  it("documents current notification polling once instead of stale fixed intervals", () => {
    assert.doesNotMatch(source("CLAUDE.md"), /polls `GET \/api\/notifications` every \*\*5 minutes\*\*/);
    assert.match(source("CLAUDE.md"), /adaptive 60s\/5min\/15min\/stop polling/);
  });

  it("keeps a visible become-maker path for non-sellers", () => {
    assert.match(source("src/app/layout.tsx"), /href="\/become-a-maker"/);
    assert.match(source("src/app/become-a-maker/page.tsx"), /signUpPathForRedirect\("\/dashboard"\)/);
    assert.match(source("src/app/become-a-maker/page.tsx"), /redirect\(userId \? "\/dashboard"/);
    assert.match(source("src/middleware.ts"), /"\/become-a-maker"/);
    assert.match(source("src/app/account/page.tsx"), /!sellerProfile &&/);
    assert.match(source("src/app/account/page.tsx"), /Become a Maker/);
    assert.match(source("src/components/UserAvatarMenu.tsx"), /!hasSeller &&/);
    assert.match(source("src/components/UserAvatarMenu.tsx"), /Start Selling/);
    assert.match(source("src/components/Header.tsx"), /!hasSeller &&/);
    assert.match(source("src/components/Header.tsx"), /Start Selling/);
  });

  it("blocks broad Prisma user relation selects in source code", () => {
    for (const path of tsSourceFiles("src")) {
      const text = source(path);

      assert.doesNotMatch(text, /include:\s*\{\s*user:\s*true\b/, `${path} should not include full user rows`);
      assert.doesNotMatch(text, /select:\s*\{\s*user:\s*true\b/, `${path} should not select full user rows`);
    }
  });
});
