import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Clerk webhook credential-recovery contract", () => {
  it("keeps the production signing secret out of ordinary CI", () => {
    const ci = source(".github/workflows/ci.yml");

    assert.doesNotMatch(ci, /CLERK_WEBHOOK_SECRET:\s*\$\{\{\s*secrets\.CLERK_WEBHOOK_SECRET/);
  });

  it("keeps one strict runtime secret and no unsafe legal-state authority", () => {
    const route = source("src/app/api/clerk/webhook/route.ts");
    const ensureUser = source("src/lib/ensureUser.ts");
    const acceptance = source("src/app/api/account/accept-terms/route.ts");

    assert.equal((route.match(/process\.env\.CLERK_WEBHOOK_SECRET/g) ?? []).length, 1);
    assert.doesNotMatch(route, /CLERK_WEBHOOK_SECRET_PREVIOUS/);
    assert.doesNotMatch(route, /unsafe_metadata|legal_accepted_at/);
    assert.doesNotMatch(ensureUser, /unsafeMetadata|dateFromMetadata/);
    assert.match(acceptance, /prisma\.\$transaction\(async \(tx\)/);
    assert.match(acceptance, /logUserAuditActionOrThrow/);
    assert.match(acceptance, /client: tx/);
  });

  it("does not amplify unauthenticated failures through shared telemetry", () => {
    const route = source("src/app/api/clerk/webhook/route.ts");
    const preAuth = route.slice(route.indexOf("if (!webhookSecret)"), route.indexOf("let reservation:"));
    const verified = route.slice(route.indexOf("let reservation:"));

    assert.doesNotMatch(preAuth, /Sentry\.capture|recordWebhookFailureSpike/);
    assert.doesNotMatch(preAuth, /throw err/);
    assert.match(preAuth, /error: "Invalid body"/);
    assert.match(verified, /source: "clerk_webhook_reservation"/);
    assert.match(verified, /kind: "reservation"/);
    assert.match(verified, /source: "clerk_webhook"/);
    assert.match(verified, /kind: "handler"/);
  });

  it("requires provenance cleanup and real provider delivery before acceptance", () => {
    const plan = source("docs/clerk-webhook-secret-credential-recovery.md").replace(/\s+/g, " ");

    assert.match(plan, /engine-read-only aggregate inspection/);
    assert.match(plan, /users lacking trusted provenance must have the three legal fields cleared/);
    assert.match(plan, /genuine provider-signed delivery/);
    assert.match(plan, /locally signed simulation proves the provider URL/);
    assert.match(plan, /unique sentinel Clerk id that is first proven absent from production/);
    assert.match(plan, /Do not assume the same logical event carries the same `svix-id`/);
  });

  it("converges to one Production-only Vercel consumer", () => {
    const plan = source("docs/clerk-webhook-secret-credential-recovery.md").replace(/\s+/g, " ");

    assert.match(plan, /project-local, sensitive, Production-only Vercel `CLERK_WEBHOOK_SECRET` row/);
    assert.match(plan, /must not be shared with Preview or Development, stored in GitHub CI, or retained as a routine local/);
    assert.match(plan, /delete the now-unused GitHub secret/);
    assert.match(plan, /delete only the exact predecessor endpoint/);
  });
});
