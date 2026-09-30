import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyOrderEmailFreeDeploymentSurface } from "../scripts/verify-order-email-free-deployment-surface.mjs";

const workflow = readFileSync(
  ".github/workflows/order-seller-email-projection-predecessor-retirement-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("retirement workflow is manual, exact-main, live-deployment and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /production_deployment_id:/);
  assert.match(workflow, /inputs\.confirmation == 'retire-reviewed-order-seller-email-projection-predecessors'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /group: production-database-migrations/);
  assert.match(workflow, /main\.commit\.sha !== sha[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/);
  assert.match(workflow, /Verify exact email-free deployment is live before revoking overlap grants/);
  assert.match(workflow, /node scripts\/verify-order-email-free-deployment-surface\.mjs/);
});

function fakeDeploymentSurfaceFetch({ deploymentId, geoBlocked = false, mutate } = {}) {
  return async (input) => {
    const request = new URL(input);
    let response;
    if (request.hostname === "thegrainline.com" && request.pathname === "/api/health") {
      response = Response.json({ ok: true });
    } else if (["thegrainline.com", "grainline.vercel.app"].includes(request.hostname)) {
      if (geoBlocked && request.pathname === "/") {
        response = new Response("geo-blocked", {
          status: 307,
          headers: {
            location: `https://${request.hostname}/not-available`,
            server: "Vercel",
          },
        });
      } else {
        response = new Response(`<meta content="dpl=${deploymentId}">`, {
          status: 200,
        });
      }
    } else if (request.hostname === "www.thegrainline.com") {
      response = new Response(null, {
        status: 308,
        headers: { location: "https://thegrainline.com/" },
      });
    } else if (request.hostname === "grainline-drew-youngs-projects.vercel.app" ||
               request.hostname === "grainline-git-main-drew-youngs-projects.vercel.app") {
      const redirect = new URL("https://vercel.com/sso-api");
      redirect.searchParams.set("url", request.toString());
      redirect.searchParams.set("nonce", "a".repeat(64));
      response = new Response("protected", {
        status: 302,
        headers: { location: redirect.toString(), server: "Vercel" },
      });
    } else {
      throw new Error(`Unexpected deployment-surface request: ${request}`);
    }
    return mutate ? mutate({ request, response }) : response;
  };
}

test("live deployment guard accepts public markers and exact protected-alias SSO redirects", async () => {
  const deploymentId = "dpl_A12345678901234567890123";
  await verifyOrderEmailFreeDeploymentSurface({
    deploymentId,
    cacheBuster: 1234,
    fetchImpl: fakeDeploymentSurfaceFetch({ deploymentId }),
  });
});

test("live deployment guard accepts the exact application-owned non-US redirect", async () => {
  const deploymentId = "dpl_A12345678901234567890123";
  await verifyOrderEmailFreeDeploymentSurface({
    deploymentId,
    cacheBuster: 1234,
    fetchImpl: fakeDeploymentSurfaceFetch({ deploymentId, geoBlocked: true }),
  });
});

test("live deployment guard rejects a non-US redirect away from its exact same-origin page", async () => {
  const deploymentId = "dpl_A12345678901234567890123";
  await assert.rejects(
    verifyOrderEmailFreeDeploymentSurface({
      deploymentId,
      cacheBuster: 1234,
      fetchImpl: fakeDeploymentSurfaceFetch({
        deploymentId,
        geoBlocked: true,
        mutate: ({ request, response }) => {
          if (request.hostname !== "thegrainline.com" || request.pathname !== "/") return response;
          return new Response("geo-blocked", {
            status: 307,
            headers: {
              location: "https://unreviewed.example/not-available",
              server: "Vercel",
            },
          });
        },
      }),
    }),
    /thegrainline\.com/,
  );
});

test("live deployment guard rejects a protected alias redirect for another target", async () => {
  const deploymentId = "dpl_A12345678901234567890123";
  await assert.rejects(
    verifyOrderEmailFreeDeploymentSurface({
      deploymentId,
      cacheBuster: 1234,
      fetchImpl: fakeDeploymentSurfaceFetch({
        deploymentId,
        mutate: ({ request, response }) => {
          if (request.hostname !== "grainline-drew-youngs-projects.vercel.app") return response;
          const redirect = new URL(response.headers.get("location"));
          redirect.searchParams.set("url", "https://unreviewed.example/");
          return new Response("protected", {
            status: 302,
            headers: { location: redirect.toString(), server: "Vercel" },
          });
        },
      }),
    }),
    /grainline-drew-youngs-projects\.vercel\.app/,
  );
});

test("workflow admits only the exact checksummed latest retirement migration", () => {
  assert.match(workflow, /3a1f173fac0293ec05c43b44e9cd2a6895dcdd47effce55236e7e7c7a55fb799\s+prisma\/migrations\/20260928220000_retire_seller_buyer_email_projection_predecessors\/migration\.sql/);
  assert.match(workflow, /latest.*20260928220000_retire_seller_buyer_email_projection_predecessors/);
  assert.match(workflow, /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed seller email-projection predecessor retirement/);
});

test("postflight proves only predecessor grants changed and RLS posture stayed fixed", () => {
  for (const name of [
    "grainline_order_seller_detail_v2",
    "grainline_order_seller_detail_v3",
    "grainline_order_seller_detail_v4",
    "grainline_order_seller_recent_sales",
    "grainline_order_seller_detail_v5",
    "grainline_order_seller_recent_sales_v2",
  ]) assert.match(workflow, new RegExp(name));
  assert.match(workflow, /assert\.deepEqual\(definitions\.rows, before\.definitions\)/);
  assert.match(workflow, /assert\.deepEqual\(posture\.rows, before\.posture\)/);
  assert.doesNotMatch(workflow, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/i);
});

test("CI holds retirement until the email-free successor has been applied", () => {
  const verify = ciWorkflow.indexOf(
    "Verify Order seller email-projection predecessor retirement source package",
  );
  const isolate = ciWorkflow.indexOf(
    "Isolate Order seller email-projection predecessor retirement until its successor is proven",
  );
  const successorApply = ciWorkflow.indexOf(
    "Apply only Order seller buyer-email projection in disposable PostgreSQL",
  );
  const historicalProof = ciWorkflow.indexOf(
    "Prove Order compatible postflight through the runtime login",
  );
  const restore = ciWorkflow.indexOf(
    "Restore Order seller email-projection predecessor retirement",
  );
  const retirementApply = ciWorkflow.indexOf(
    "Apply only Order seller email-projection predecessor retirement in disposable PostgreSQL",
  );
  const build = ciWorkflow.indexOf("Production build");
  assert.ok(verify > 0 && verify < isolate);
  assert.ok(isolate < historicalProof);
  assert.ok(historicalProof < successorApply);
  assert.ok(successorApply < restore);
  assert.ok(restore < retirementApply);
  assert.ok(retirementApply < build);
  assert.match(ciWorkflow, /ORDER_SELLER_EMAIL_PROJECTION_RETIREMENT_MIGRATION_PATH=\$correction\/migration\.sql/);
});
