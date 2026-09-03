import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const plan = readFileSync("docs/shippo-api-credential-recovery.md", "utf8");
const incident = readFileSync(
  "docs/comprehensive-credential-exposure-recovery-20260902.md",
  "utf8",
);
const strategy = readFileSync("STRATEGY.md", "utf8");
const normalizedPlan = plan.replace(/\s+/g, " ");
const normalizedIncident = incident.replace(/\s+/g, " ");
const normalizedStrategy = strategy.replace(/\s+/g, " ");

describe("Shippo API credential recovery plan", () => {
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
    assert.match(normalizedIncident, /## Next family: Shippo test API token/);
    assert.match(normalizedIncident, /docs\/shippo-api-credential-recovery\.md/);
    assert.match(normalizedStrategy, /next family after shipping-rate acceptance is the exposed Shippo test API token/);
    assert.match(normalizedStrategy, /docs\/shippo-api-credential-recovery\.md/);
  });
});
