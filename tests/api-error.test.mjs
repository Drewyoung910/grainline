import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { readApiErrorMessage } = await import("../src/lib/apiError.ts");

describe("api error messages", () => {
  it("uses structured API errors", async () => {
    const response = new Response(JSON.stringify({ error: "Nope" }), { status: 400 });
    assert.equal(await readApiErrorMessage(response, "Fallback"), "Nope");
  });

  it("adds retry guidance for unstructured 429s", async () => {
    const response = new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": "120" },
    });
    assert.equal(
      await readApiErrorMessage(response, "Fallback"),
      "Too many requests Try again in 2 minutes.",
    );
  });

  it("does not duplicate retry guidance from the API body", async () => {
    const response = new Response(JSON.stringify({ error: "Too many requests. Try again in a moment." }), {
      status: 429,
      headers: { "Retry-After": "10" },
    });
    assert.equal(await readApiErrorMessage(response, "Fallback"), "Too many requests. Try again in a moment.");
  });

  it("handles the shared rateLimitResponse payload shape", async () => {
    const response = new Response(JSON.stringify({
      error: "Too many requests. Try again in 2 minutes.",
      code: "RATE_LIMITED",
      retryAfterSeconds: 120,
      retryAt: "2026-05-23T12:02:00.000Z",
    }), {
      status: 429,
      headers: { "Retry-After": "120" },
    });

    assert.equal(await readApiErrorMessage(response, "Fallback"), "Too many requests. Try again in 2 minutes.");
  });

  it("does not surface raw 5xx text bodies", async () => {
    const response = new Response("Prisma timeout at internal-host.example", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });

    assert.equal(await readApiErrorMessage(response, "Fallback"), "Fallback");
  });

  it("does not surface HTML error pages as user-facing copy", async () => {
    const response = new Response("<html><body>Bad gateway</body></html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });

    assert.equal(await readApiErrorMessage(response, "Fallback"), "Fallback");
  });
});
