import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyOrderEmailFreeDeploymentSurface } from "../scripts/verify-order-email-free-deployment-surface.mjs";

const workflow = readFileSync(
  ".github/workflows/seller-profile-private-predecessor-retirement-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");

const correction = "20261015000000_correct_seller_profile_private_app_authorities";
const retirement = "20261015010000_retire_seller_profile_private_predecessor";
const retirementDigest = "d111e615a40cd0c2936eeb137db23c5fbcc63c7acb81bce27a36d71229963b3a";
const deploymentId = "dpl_A12345678901234567890123";
const releaseCommit = "a".repeat(40);

test("SellerProfile predecessor retirement is exact-main, exact-CI, live-deployment and Production-bound", () => {
  assert.match(workflow, /production_deployment_id:/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /run\.head_sha !== sha/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
  assert.match(workflow, /Verify exact converted deployment is live on canonical aliases/u);
  assert.match(workflow, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.match(workflow, /REVIEWED_RELEASE_COMMIT: \$\{\{ inputs\.release_commit \}\}/u);
});

function liveSurface({ commit = releaseCommit } = {}) {
  return async (input) => {
    const request = new URL(input);
    if (request.hostname === "thegrainline.com" && request.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    if (["thegrainline.com", "grainline.vercel.app"].includes(request.hostname)) {
      return new Response(
        `<meta content="${commit}" name="grainline-release-commit"><div>dpl=${deploymentId}</div>`,
        { status: 200 },
      );
    }
    if (request.hostname === "www.thegrainline.com") {
      return new Response(null, { status: 308, headers: { location: "https://thegrainline.com/" } });
    }
    if (["grainline-drew-youngs-projects.vercel.app", "grainline-git-main-drew-youngs-projects.vercel.app"].includes(request.hostname)) {
      const redirect = new URL("https://vercel.com/sso-api");
      redirect.searchParams.set("url", request.toString());
      redirect.searchParams.set("nonce", "a".repeat(64));
      return new Response("protected", {
        status: 302,
        headers: { location: redirect.toString(), server: "Vercel" },
      });
    }
    throw new Error(`unexpected URL: ${request}`);
  };
}

test("live deployment proof binds public aliases to both deployment and reviewed source commit", async () => {
  assert.match(layout, /VERCEL_GIT_COMMIT_SHA/u);
  assert.match(layout, /grainline-release-commit/u);
  await verifyOrderEmailFreeDeploymentSurface({
    deploymentId,
    releaseCommit,
    cacheBuster: 1,
    fetchImpl: liveSurface(),
  });
  await assert.rejects(
    verifyOrderEmailFreeDeploymentSurface({
      deploymentId,
      releaseCommit,
      cacheBuster: 1,
      fetchImpl: liveSurface({ commit: "b".repeat(40) }),
    }),
    /thegrainline\.com/u,
  );
});

test("retirement requires the correction and admits only exact immutable retirement bytes", () => {
  assert.match(workflow, new RegExp(correction, "u"));
  assert.match(workflow, /required SellerProfile app-authority correction is missing/u);
  assert.match(workflow, new RegExp(`${retirementDigest}  prisma/migrations/${retirement}/migration\\.sql`, "u"));
  assert.match(workflow, /Require only the reviewed predecessor retirement pending[\s\S]*assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 1);
});

test("retirement proves convergence, column removal, initializer isolation, and unchanged RLS", () => {
  assert.match(workflow, /privateColumns\.length/u);
  assert.match(workflow, /mismatch_count/u);
  assert.match(workflow, /SellerProfile_private_initialize/u);
  assert.match(workflow, /SellerProfile_private_mirror/u);
  assert.match(workflow, /SellerProfile_supported_snapshot/u);
  assert.match(workflow, /runtime_execute: false, staff_execute: false, public_execute: false/u);
  assert.match(workflow, /assert\.deepEqual\(posture, before\.posture\)/u);
  assert.match(workflow, /public_private_any/u);
  assert.match(workflow, /coalesce\(target\.relacl, pg_catalog\.acldefault/u);
  assert.doesNotMatch(workflow, /pg_catalog\.coalesce/u);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu);
});

test("CI applies retirement after correction and before grant convergence and build", () => {
  const correctionApply = ci.indexOf("Apply SellerProfile private app-authority correction in disposable PostgreSQL");
  const retirementApply = ci.indexOf("Apply SellerProfile private predecessor retirement in disposable PostgreSQL");
  const grants = ci.indexOf("Converge runtime grants after SellerProfile private boundary");
  const build = ci.indexOf("Production build");
  assert.ok(correctionApply >= 0 && retirementApply > correctionApply && grants > retirementApply && build > grants);
  assert.match(ci, /seller-profile-private-predecessor-retirement-production-workflow\.test\.mjs/u);
  assert.match(ci, new RegExp(retirement, "u"));
  assert.match(
    ci,
    /Apply SellerProfile private predecessor retirement in disposable PostgreSQL[\s\S]*'spr-' \|\| pg_catalog\.md5\(:'migration'\)/u,
  );
});
