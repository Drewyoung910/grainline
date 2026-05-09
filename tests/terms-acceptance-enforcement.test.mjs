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
    assert.match(middleware, /NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
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
    assert.match(form, /window\.location\.assign\(redirectUrl\)/);
    assert.doesNotMatch(page + form, /onClose|setOpen|Dialog|Modal|dismiss/i);
  });
});
