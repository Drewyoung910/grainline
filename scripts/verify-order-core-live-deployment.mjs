#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const REVIEWED_ORDER_DEPLOYMENT = Object.freeze({
  id: "dpl_FKdRWV3J8XxxrRUSWVdis6P6VWBe",
  sourceCommit: "4ee0911d7ca4b975a5c52292029242440b452c43",
});

export const DIRECT_PUBLIC_ORIGINS = Object.freeze([
  "https://thegrainline.com",
  "https://grainline.vercel.app",
]);

export const REDIRECT_PUBLIC_ORIGINS = Object.freeze([
  Object.freeze({
    origin: "https://www.thegrainline.com",
    pageLocation: "https://thegrainline.com/",
    healthLocation: "https://thegrainline.com/api/health",
  }),
]);

const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_HEADERS = Object.freeze({
  "cache-control": "no-cache",
  "user-agent": "grainline-order-core-enable/1.0",
});

async function boundedText(response, label) {
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new Error(`${label} exceeded the response-size limit`);
  }
  return body;
}

async function assertDirectOrigin(fetchFn, origin, deploymentId) {
  const page = await fetchFn(`${origin}/`, {
    redirect: "manual",
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert.equal(page.status, 200, `${origin} homepage is not directly available`);
  assert.match(
    page.headers.get("content-type") ?? "",
    /^text\/html(?:;|$)/iu,
    `${origin} homepage content type drifted`,
  );
  const pageBody = await boundedText(page, `${origin} homepage`);
  assert.equal(
    pageBody.includes(`dpl=${deploymentId}`),
    true,
    `${origin} is not serving the reviewed deployment`,
  );

  const health = await fetchFn(`${origin}/api/health`, {
    redirect: "manual",
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert.equal(health.status, 200, `${origin} health is not directly available`);
  assert.match(
    health.headers.get("content-type") ?? "",
    /^application\/json(?:;|$)/iu,
    `${origin} health content type drifted`,
  );
  assert.match(
    health.headers.get("cache-control") ?? "",
    /(?:^|,)\s*(?:private\s*,\s*)?no-store(?:\s*,|$)/iu,
    `${origin} health cache policy drifted`,
  );
  const healthBody = await boundedText(health, `${origin} health`);
  let payload;
  try {
    payload = JSON.parse(healthBody);
  } catch {
    throw new Error(`${origin} health did not return JSON`);
  }
  assert.equal(payload?.ok, true, `${origin} health is not accepted`);
}

async function assertRedirectOrigin(fetchFn, redirect) {
  for (const [path, expectedLocation] of [
    ["/", redirect.pageLocation],
    ["/api/health", redirect.healthLocation],
  ]) {
    const response = await fetchFn(`${redirect.origin}${path}`, {
      redirect: "manual",
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert.equal(response.status, 308, `${redirect.origin}${path} redirect status drifted`);
    assert.equal(
      response.headers.get("location"),
      expectedLocation,
      `${redirect.origin}${path} redirect target drifted`,
    );
    await boundedText(response, `${redirect.origin}${path}`);
  }
}

export async function verifyOrderCoreLiveDeployment({
  deploymentId = process.env.ORDER_CORE_PRODUCTION_DEPLOYMENT_ID,
  fetchFn = globalThis.fetch,
} = {}) {
  assert.equal(
    deploymentId,
    REVIEWED_ORDER_DEPLOYMENT.id,
    "Core Order Production deployment binding drifted",
  );
  assert.equal(typeof fetchFn, "function", "Core Order deployment verifier requires fetch");

  for (const origin of DIRECT_PUBLIC_ORIGINS) {
    await assertDirectOrigin(fetchFn, origin, deploymentId);
  }
  for (const redirect of REDIRECT_PUBLIC_ORIGINS) {
    await assertRedirectOrigin(fetchFn, redirect);
  }

  return Object.freeze({
    deploymentId,
    reviewedSourceCommit: REVIEWED_ORDER_DEPLOYMENT.sourceCommit,
    directOrigins: DIRECT_PUBLIC_ORIGINS.length,
    redirectOrigins: REDIRECT_PUBLIC_ORIGINS.length,
    healthy: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) {
      throw new Error("Core Order live-deployment verifier takes no arguments");
    }
    const result = await verifyOrderCoreLiveDeployment();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Core Order live-deployment verification failed"}\n`,
    );
    process.exitCode = 1;
  }
}
