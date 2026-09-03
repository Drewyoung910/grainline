import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function publicBlock() {
  const middleware = source("src/middleware.ts");
  const match = middleware.match(/const isPublic = createRouteMatcher\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "middleware should define isPublic matcher");
  return match[1];
}

function termsAllowedBlock() {
  const middleware = source("src/middleware.ts");
  const match = middleware.match(/const isTermsAcceptanceAllowed = createRouteMatcher\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "middleware should define isTermsAcceptanceAllowed matcher");
  return match[1];
}

describe("terms acceptance enforcement", () => {
  it("keeps missing-terms users out of public and private app routes", () => {
    const middleware = source("src/middleware.ts");
    const allowed = termsAllowedBlock();

    assert.match(middleware, /if \(userId && !isTermsAcceptanceAllowed\(req\) && shouldRequireTermsAcceptance\(account\)\) \{/);
    assert.match(middleware, /return termsRequiredFor\(req, requestId\);/);

    for (const route of ['"/"', '"/browse(.*)"', '"/dashboard(.*)"', '"/account(.*)"', '"/messages(.*)"']) {
      assert.equal(allowed.includes(route), false, `${route} must not bypass durable terms acceptance`);
    }
  });

  it("routes auth completion through the durable full-page accept-terms gate", () => {
    const signIn = source("src/app/sign-in/[[...sign-in]]/page.tsx");
    const signUp = source("src/app/sign-up/[[...sign-up]]/page.tsx");

    assert.match(signIn, /const postAuthUrl = acceptTermsPathForRedirect\(redirectUrl\)/);
    assert.match(signIn, /forceRedirectUrl=\{postAuthUrl\}/);
    assert.match(signIn, /fallbackRedirectUrl=\{postAuthUrl\}/);

    assert.match(signUp, /const postAuthUrl = acceptTermsPathForRedirect\(redirectUrl\)/);
    assert.match(signUp, /forceRedirectUrl=\{postAuthUrl\}/);
    assert.match(signUp, /fallbackRedirectUrl=\{postAuthUrl\}/);
    assert.doesNotMatch(signUp, /unsafeMetadata/);
    assert.doesNotMatch(signUp, /termsAcceptedAt/);
  });

  it("keeps signed-out launch routes explicit instead of Clerk 404 rewrites", () => {
    const middleware = source("src/middleware.ts");
    const publicRoutes = publicBlock();
    const allowed = termsAllowedBlock();

    assert.match(middleware, /signInPathForRedirect/);
    assert.match(middleware, /function signInRequiredFor/);
    assert.match(middleware, /privateApiJson\(\{ error: "Unauthorized" \}, \{ status: HTTP_STATUS\.UNAUTHORIZED \}, requestId\)/);
    assert.match(middleware, /import \{ privateResponse \} from "@\/lib\/privateResponse"/);
    assert.match(middleware, /if \(!userId && !isPublic\(req\)\) \{/);
    assert.doesNotMatch(middleware, /auth\.protect\(/);

    assert.match(publicRoutes, /"\/cart\(\.\*\)"/);
    assert.match(publicRoutes, /"\/accept-terms\(\.\*\)"/);
    assert.equal(allowed.includes('"/cart(.*)"'), false, "signed-in users missing terms must not use cart");
  });

  it("keeps accept-terms as a non-dismissible full page, not an overlay modal", () => {
    const page = source("src/app/accept-terms/page.tsx");
    const form = source("src/app/accept-terms/AcceptTermsForm.tsx");

    assert.match(page, /<main className="min-h-\[100svh\]/);
    assert.match(form, /window\.location\.assign\(safeInternalPath\(redirectUrl, "\/account"\)\)/);
    assert.doesNotMatch(page + form, /onClose|setOpen|Dialog|Modal|dismiss/i);
  });

  it("leaves a retained user audit trail when durable terms are accepted", () => {
    const route = source("src/app/api/account/accept-terms/route.ts");

    assert.match(route, /import \{ logUserAuditActionOrThrow \} from "@\/lib\/audit"/);
    assert.match(route, /const user = await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(route, /await tx\.user\.update\(\{/);
    assert.match(route, /await logUserAuditActionOrThrow\(\{/);
    assert.match(route, /client: tx/);
    assert.match(route, /action: "TERMS_ACCEPTED"/);
    assert.match(route, /targetType: "USER"/);
    assert.match(route, /termsVersion: updated\.termsVersion/);
    assert.match(route, /termsAcceptedAt: updated\.termsAcceptedAt\?\.toISOString\(\) \?\? acceptedAt\.toISOString\(\)/);
    assert.match(route, /ageAttestedAt: updated\.ageAttestedAt\?\.toISOString\(\) \?\? null/);
    assert.match(route, /route: "\/api\/account\/accept-terms"/);
  });

  it("keeps client-writable Clerk metadata out of durable legal acceptance state", () => {
    const webhook = source("src/app/api/clerk/webhook/route.ts");
    const ensureUser = source("src/lib/ensureUser.ts");
    const acceptance = source("src/app/api/account/accept-terms/route.ts");

    assert.doesNotMatch(webhook, /unsafe_metadata|legal_accepted_at/);
    assert.doesNotMatch(webhook, /clerk_webhook_terms_account_state_cache_invalidate/);
    assert.doesNotMatch(ensureUser, /unsafeMetadata|dateFromMetadata/);
    assert.doesNotMatch(
      ensureUser,
      /termsAcceptedAt\?:|termsVersion\?:|ageAttestedAt\?:/,
      "generic identity synchronization must not accept legal-state write authority",
    );
    assert.match(acceptance, /const acceptedAt = new Date\(\)/);
    assert.match(acceptance, /action: "TERMS_ACCEPTED"/);
    assert.ok(
      acceptance.indexOf("await tx.user.update") < acceptance.indexOf("await logUserAuditActionOrThrow"),
      "the trusted audit row must be written after the legal state in the same transaction",
    );
  });
});
