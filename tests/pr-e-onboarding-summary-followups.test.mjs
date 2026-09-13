import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("PR E onboarding summary follow-ups", () => {
  it("keeps final summary copy conditional on completing Stripe and listing requirements", () => {
    const wizard = source("src/app/dashboard/onboarding/OnboardingWizard.tsx");

    assert.match(wizard, /const stripeReady = chargesEnabled \|\| completed\.step3/);
    assert.match(wizard, /const canComplete = stripeReady && listingCount > 0/);
    assert.match(wizard, /canComplete \? "Your shop is ready!" : "Finish your shop setup"/);
    assert.match(wizard, /Complete the remaining items below before opening your dashboard/);
  });

  it("keeps every summary section revisitable and keeps saved listings reachable", () => {
    const wizard = source("src/app/dashboard/onboarding/OnboardingWizard.tsx");
    const page = source("src/app/dashboard/onboarding/page.tsx");

    for (const step of [1, 2, 3, 4]) {
      assert.match(wizard, new RegExp(`setStep\\(${step}\\)`));
    }
    assert.match(page, /listings: \{\s*orderBy: \{ createdAt: "desc" \}/s);
    assert.match(page, /latestListing=\{sp\.listings\[0\] \?\? null\}/);
    assert.match(wizard, /href=\{`\/dashboard\/listings\/\$\{latestListing\.id\}\/edit`\}/);
    assert.match(wizard, /Open draft/);
  });

  it("does not reintroduce duplicate create-listing actions in the listing step", () => {
    const wizard = source("src/app/dashboard/onboarding/OnboardingWizard.tsx");
    const listingStep = wizard.slice(
      wizard.indexOf("{/* ── Step 4: Your First Listing"),
      wizard.indexOf("{/* ── Step 5: All set!"),
    );

    assert.equal((listingStep.match(/Create a Listing/g) ?? []).length, 1);

    // The previous disabled secondary button labelled "Create a listing first" was
    // visually indistinguishable from a real action. The secondary button must read
    // "Skip for now" so its disabled-vs-enabled state matches buyer expectation.
    assert.equal(listingStep.includes("Create a listing first"), false);
    assert.match(listingStep, /Skip for now/);
  });
});
