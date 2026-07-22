import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNeonOwnerDirectUrl,
  buildNeonRuntimePoolerUrl,
  validateNeonRuntimePasswordResponse,
  validateNeonOwnerResetResponse,
  waitForReviewedNeonOperations,
} from "../scripts/neon-owner-password-control.mjs";

const OWNER_URL = "postgresql://neondb_owner:old-password@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const PASSWORD = "AbCdEfGhIjKlMn_1";
const RUNTIME_PASSWORD = "AbCdEfGhIjKlMn_1".repeat(4);

describe("pinned Neon owner password control", () => {
  it("accepts only the observed 16-character reset response on the reviewed target", () => {
    const payload = {
      role: {
        branch_id: "br-hidden-mouse-aaugn2wr",
        name: "neondb_owner",
        authentication_method: "password",
        updated_at: "2026-07-21T20:00:00Z",
        password: PASSWORD,
      },
      operations: [{
        id: "operation-1234",
        project_id: "icy-unit-96812898",
        branch_id: "br-hidden-mouse-aaugn2wr",
        action: "reset_password",
        status: "running",
      }],
    };
    assert.equal(validateNeonOwnerResetResponse(payload).password, PASSWORD);
    assert.throws(() => validateNeonOwnerResetResponse({
      ...payload,
      role: { ...payload.role, password: `${PASSWORD}x` },
    }));
  });

  it("changes only password material in the reviewed owner URL", () => {
    const next = buildNeonOwnerDirectUrl(OWNER_URL, PASSWORD);
    assert.equal(new URL(next).password, PASSWORD);
    assert.equal(new URL(next).hostname, new URL(OWNER_URL).hostname);
    assert.throws(() => buildNeonOwnerDirectUrl(
      OWNER_URL.replace("ep-plain-river-aaqg8gj4", "ep-wrong"),
      PASSWORD,
    ));
  });

  it("builds the exact pooled runtime URL from an in-memory Neon reveal", () => {
    const runtime = buildNeonRuntimePoolerUrl(
      validateNeonRuntimePasswordResponse({ password: RUNTIME_PASSWORD }),
    );
    const parsed = new URL(runtime);
    assert.equal(parsed.username, "grainline_app_runtime");
    assert.equal(parsed.password, RUNTIME_PASSWORD);
    assert.equal(
      parsed.hostname,
      "ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech",
    );
    assert.equal(parsed.port, "5432");
    assert.equal(parsed.pathname, "/neondb");
    assert.throws(() => validateNeonRuntimePasswordResponse({ password: "short" }));
  });

  it("waits for every returned operation and fails on terminal error", async () => {
    const calls = [];
    const finished = await waitForReviewedNeonOperations(
      [{ id: "operation-1234", action: "reset_password", status: "running" }],
      async (id) => {
        calls.push(id);
        return { id, action: "reset_password", status: "finished" };
      },
      async () => {},
    );
    assert.deepEqual(calls, ["operation-1234"]);
    assert.equal(finished[0].status, "finished");
    await assert.rejects(() => waitForReviewedNeonOperations([
      { id: "operation-1234", action: "reset_password", status: "failed" },
    ]), /failed/);
  });
});
