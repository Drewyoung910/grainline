import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const plan = readFileSync("docs/shippo-api-credential-recovery.md", "utf8");
const incident = readFileSync(
  "docs/comprehensive-credential-exposure-recovery-20260902.md",
  "utf8",
);
const strategy = readFileSync("STRATEGY.md", "utf8");
const shippingRecovery = readFileSync(
  "docs/shipping-rate-secret-credential-recovery.md",
  "utf8",
);
const normalizedPlan = plan.replace(/\s+/g, " ");
const normalizedIncident = incident.replace(/\s+/g, " ");
const normalizedStrategy = strategy.replace(/\s+/g, " ");
const normalizedShippingRecovery = shippingRecovery.replace(/\s+/g, " ");

describe("Shippo API credential recovery plan", () => {
  it("starts only after the accepted shipping-rate secret closure", () => {
    assert.match(normalizedShippingRecovery, /Operator main: `568b29dbea96f1874dda0145db49b52c87ca964d`/);
    assert.match(normalizedShippingRecovery, /Final replacement-only deployment: `dpl_4La1GXphy21feYp4AdYgT7Q2Zs7f`/);
    assert.match(normalizedShippingRecovery, /c9c79ae60656de78365276f1ddd83796958391a26493817fae61376367284161/);
    assert.match(normalizedShippingRecovery, /accepts the replacement and rejects the exposed original/);
    assert.match(normalizedShippingRecovery, /private restart journal is absent/);
  });

  it("pins the one shared consumer and rejects a project-local shadow", () => {
    assert.match(plan, /env_374M3muVPW3jIKBS8X4Q7kqI/);
    assert.match(plan, /team_wvQeQHZGwCSwinC1uB7xbpjr/);
    assert.match(plan, /prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp/);
    assert.match(plan, /no project-local `SHIPPO_API_KEY` shadow exists/);
    assert.match(normalizedPlan, /Development, Preview and Production/);
  });

  it("uses provider overlap without inventing an application previous key", () => {
    assert.match(normalizedPlan, /two simultaneously active test tokens/);
    assert.match(normalizedPlan, /delete only the exposed predecessor/);
    assert.match(normalizedPlan, /Do not create a project-local shadow or a `SHIPPO_API_KEY_PREVIOUS` variable/);
    assert.match(normalizedPlan, /Do not request, create, use or delete a Shippo live-mode token/);
  });

  it("keeps provider proof non-charging and evidence secret-free", () => {
    assert.match(normalizedPlan, /must not create a Transaction or purchase a label/);
    assert.match(normalizedPlan, /predecessor to return authentication rejection/);
    assert.match(normalizedPlan, /It contains no raw token, address, email, rate ID/);
    assert.match(normalizedPlan, /same test Shippo account and return checkout-usable USD rates/);
  });

  it("is durably routed from the incident and strategy records", () => {
    assert.match(normalizedIncident, /## Completed Shippo test API family/);
    assert.match(normalizedIncident, /docs\/shippo-api-credential-recovery\.md/);
    assert.match(normalizedIncident, /ebcd62085d611bc09e6b4d4ee8e3f4dc38c9c1cf31cb6ba51e1dd68bff6e3f66/);
    assert.match(normalizedStrategy, /Shippo test-token family completed on 2026-09-03/);
    assert.match(normalizedStrategy, /docs\/shippo-api-credential-recovery\.md/);
  });

  it("records accepted provider, deployment, and negative proof", () => {
    assert.match(normalizedPlan, /Status: completed and accepted on 2026-09-03/);
    assert.match(normalizedPlan, /a12a13ce4667f7274b7b8f00c70def5ceaefcde1/);
    assert.match(normalizedPlan, /dpl_6Qndfy4oiiGCkWdcZXYRDzsraqFz/);
    assert.match(normalizedPlan, /same normalized 11-carrier account identity/);
    assert.match(normalizedPlan, /no Shippo Transaction, label purchase, migration, RLS change/);
    assert.match(normalizedPlan, /secret-bearing restart journal is absent/);
  });
});
