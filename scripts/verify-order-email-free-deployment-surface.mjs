import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC_ALIASES = Object.freeze([
  "thegrainline.com",
  "grainline.vercel.app",
]);

const PROTECTED_ALIASES = Object.freeze([
  "grainline-drew-youngs-projects.vercel.app",
  "grainline-git-main-drew-youngs-projects.vercel.app",
]);

const NO_STORE_HEADERS = Object.freeze({ "cache-control": "no-store" });
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECT_BODY_BYTES = 4 * 1024;

function checkedUrl(value, label) {
  assert.ok(value, `${label} is missing`);
  const url = new URL(value);
  assert.equal(url.username, "", `${label} contains a username`);
  assert.equal(url.password, "", `${label} contains a password`);
  assert.equal(url.port, "", `${label} contains a port`);
  return url;
}

export async function verifyOrderEmailFreeDeploymentSurface({
  deploymentId,
  blockedPredecessorDeploymentId,
  releaseCommit,
  fetchImpl = globalThis.fetch,
  cacheBuster = Date.now(),
} = {}) {
  assert.match(deploymentId ?? "", /^dpl_[A-Za-z0-9]{20,64}$/);
  if (blockedPredecessorDeploymentId !== undefined) {
    assert.match(
      blockedPredecessorDeploymentId,
      /^dpl_[A-Za-z0-9]{20,64}$/,
    );
    assert.notEqual(blockedPredecessorDeploymentId, deploymentId);
  }
  if (releaseCommit !== undefined) {
    assert.match(releaseCommit, /^[0-9a-f]{40}$/);
  }
  assert.equal(typeof fetchImpl, "function");
  const marker = new RegExp(`dpl=${deploymentId}(?:["&<]|$)`);
  const releaseMarker = releaseCommit === undefined
    ? null
    : new RegExp(`<meta(?=[^>]+name=["']grainline-release-commit["'])(?=[^>]+content=["']${releaseCommit}["'])[^>]*>`, "i");

  async function verifyPublicAlias(alias, pinnedDeploymentId) {
    const requestUrl = new URL(`https://${alias}/`);
    if (pinnedDeploymentId) requestUrl.searchParams.set("dpl", pinnedDeploymentId);
    requestUrl.searchParams.set("order_release_check", String(cacheBuster));
    let response = await fetchImpl(requestUrl, {
      headers: NO_STORE_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    let body = await response.text();

    // Production is US-only. GitHub-hosted runners can legitimately arrive
    // through a non-US Vercel edge and receive the application-owned geo
    // redirect before the homepage renders. Validate that exact boundary,
    // then verify the deployment marker on the geo-allowed destination.
    if (response.status === 307) {
      assert.equal(response.headers.get("server"), "Vercel", alias);
      assert.ok(Buffer.byteLength(body, "utf8") <= MAX_REDIRECT_BODY_BYTES, alias);
      const redirect = checkedUrl(response.headers.get("location"), `${alias} geo redirect`);
      assert.equal(redirect.protocol, "https:", alias);
      assert.equal(redirect.hostname, alias, alias);
      assert.equal(redirect.pathname, "/not-available", alias);
      assert.equal(redirect.search, "", alias);
      if (pinnedDeploymentId) redirect.searchParams.set("dpl", pinnedDeploymentId);
      redirect.searchParams.set("order_release_check", String(cacheBuster));
      response = await fetchImpl(redirect, {
        headers: NO_STORE_HEADERS,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      body = await response.text();
    }

    assert.equal(response.status, 200, alias);
    assert.ok(Buffer.byteLength(body, "utf8") <= MAX_PAGE_BYTES, alias);
    assert.match(body, marker, alias);
    if (releaseMarker) assert.match(body, releaseMarker, alias);
  }

  for (const alias of PUBLIC_ALIASES) {
    await verifyPublicAlias(alias);
    // Setting Vercel's Skew Protection Threshold to the compatible deployment
    // must make requests pinned to its predecessor resolve to this deployment.
    // Otherwise an already-open browser can keep calling incompatible code
    // after direct table access is removed below.
    if (blockedPredecessorDeploymentId) {
      await verifyPublicAlias(alias, blockedPredecessorDeploymentId);
    }
  }

  for (const alias of PROTECTED_ALIASES) {
    const requestUrl = new URL(`https://${alias}/`);
    requestUrl.searchParams.set("order_release_check", String(cacheBuster));
    const response = await fetchImpl(requestUrl, {
      headers: NO_STORE_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    assert.equal(response.status, 302, alias);
    assert.equal(response.headers.get("server"), "Vercel", alias);
    assert.ok(Buffer.byteLength(body, "utf8") <= MAX_REDIRECT_BODY_BYTES, alias);

    const redirect = checkedUrl(response.headers.get("location"), `${alias} redirect`);
    assert.equal(redirect.protocol, "https:", alias);
    assert.equal(redirect.hostname, "vercel.com", alias);
    assert.equal(redirect.pathname, "/sso-api", alias);
    assert.match(redirect.searchParams.get("nonce") ?? "", /^[a-f0-9]{64}$/, alias);

    const protectedTarget = checkedUrl(
      redirect.searchParams.get("url"),
      `${alias} protected target`,
    );
    assert.equal(protectedTarget.toString(), requestUrl.toString(), alias);
  }

  const redirect = await fetchImpl("https://www.thegrainline.com/", {
    headers: NO_STORE_HEADERS,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "https://thegrainline.com/");

  const health = await fetchImpl("https://thegrainline.com/api/health", {
    headers: NO_STORE_HEADERS,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const healthBody = await health.json();
  assert.equal(health.status, 200);
  assert.equal(healthBody.ok, true);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  await verifyOrderEmailFreeDeploymentSurface({
    deploymentId: process.env.REVIEWED_PRODUCTION_DEPLOYMENT_ID,
    blockedPredecessorDeploymentId:
      process.env.REVIEWED_SUPERSEDED_DEPLOYMENT_ID,
    releaseCommit: process.env.REVIEWED_RELEASE_COMMIT,
  });
}
