import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const plan = readFileSync("docs/clerk-server-key-credential-recovery.md", "utf8");
const incident = readFileSync(
  "docs/comprehensive-credential-exposure-recovery-20260902.md",
  "utf8",
);
const strategy = readFileSync("STRATEGY.md", "utf8");
const normalizedPlan = plan.replace(/\s+/g, " ");
const normalizedIncident = incident.replace(/\s+/g, " ");
const normalizedStrategy = strategy.replace(/\s+/g, " ");

describe("Clerk server API key recovery plan", () => {
  it("separates server, webhook, and public credential families", () => {
    assert.match(normalizedPlan, /covers only the exposed `CLERK_SECRET_KEY`/);
    assert.match(normalizedPlan, /webhook signing secret is a separate endpoint-cutover family/);
    assert.match(normalizedPlan, /public publishable key is not rotated/);
    assert.match(normalizedIncident, /## Next family: Clerk server API key/);
  });

  it("pins the exact provider and current consumer topology", () => {
    assert.match(plan, /ins_3BYdVgH643MVFsiKPloUw9GUYQK/);
    assert.match(plan, /env_VXNad7lOhIh6x3YXnULLncRW/);
    assert.match(plan, /3049c74f9158f6e79ba645b6250ecb7eef8c3f0a0dbbbfbc5f683be9192b500a/);
    assert.match(normalizedPlan, /All three secret-bearing consumers match the pinned digest/);
    assert.match(normalizedPlan, /No project-local Vercel shadow exists/);
  });

  it("splits runtime and operations authority", () => {
    assert.match(plan, /grainline-production-runtime-20260903/);
    assert.match(plan, /grainline-production-operations-20260903/);
    assert.match(normalizedPlan, /Production-only, `sensitive` Vercel `CLERK_SECRET_KEY`/);
    assert.match(normalizedPlan, /GitHub repository secret and ignored local mode-`0600` file/);
    assert.match(normalizedPlan, /Do not create a Preview or Development live Clerk server key/);
  });

  it("proves real runtime and operations behavior without customer mutation", () => {
    assert.match(normalizedPlan, /authenticated `\/account` request/);
    assert.match(normalizedPlan, /always invokes Clerk `currentUser\(\)`/);
    assert.match(normalizedPlan, /create one short-lived sign-in token/);
    assert.match(normalizedPlan, /no proof may delete, ban, unban or modify an ordinary user/);
    assert.match(normalizedPlan, /revoke every temporary session or token/);
  });

  it("pins deployment, drain, shared-row retirement, and old-key rejection", () => {
    assert.match(plan, /dpl_6Qndfy4oiiGCkWdcZXYRDzsraqFz/);
    assert.match(plan, /82f58889b12095d21449494a036a327cc9feb9b1/);
    assert.match(normalizedPlan, /wait at least 330 seconds/);
    assert.match(normalizedPlan, /Delete exact compromised shared row `env_VXNad7lOhIh6x3YXnULLncRW`/);
    assert.match(normalizedPlan, /accept only its Backend API authentication rejection/);
  });

  it("keeps evidence secret-free and Order RLS paused", () => {
    assert.match(normalizedPlan, /contains no key, session cookie, ticket, email, Clerk user identifier/);
    assert.match(normalizedPlan, /does not close the Clerk webhook signing-secret exposure/);
    assert.match(normalizedPlan, /fresh authenticated Order smoke, or Order RLS/);
    assert.match(normalizedStrategy, /docs\/clerk-server-key-credential-recovery\.md/);
  });
});
