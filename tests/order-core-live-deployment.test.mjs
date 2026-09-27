import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEWED_ORDER_DEPLOYMENT,
  verifyOrderCoreLiveDeployment,
} from "../scripts/verify-order-core-live-deployment.mjs";

function response(status, body = "", location = null, headers = {}) {
  return {
    status,
    headers: {
      get: (name) => {
        const normalized = name.toLowerCase();
        if (normalized === "location") return location;
        return headers[normalized] ?? null;
      },
    },
    text: async () => body,
  };
}

function acceptedFetch(url) {
  if (url === "https://www.thegrainline.com/") {
    return response(308, "", "https://thegrainline.com/");
  }
  if (url === "https://www.thegrainline.com/api/health") {
    return response(308, "", "https://thegrainline.com/api/health");
  }
  if (url.endsWith("/api/health")) {
    return response(200, '{"ok":true}', null, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
    });
  }
  return response(200, `<html>dpl=${REVIEWED_ORDER_DEPLOYMENT.id}</html>`, null, {
    "content-type": "text/html; charset=utf-8",
  });
}

test("accepts only the reviewed live deployment and healthy public entry points", async () => {
  const result = await verifyOrderCoreLiveDeployment({
    deploymentId: REVIEWED_ORDER_DEPLOYMENT.id,
    fetchFn: acceptedFetch,
  });
  assert.deepEqual(result, {
    deploymentId: REVIEWED_ORDER_DEPLOYMENT.id,
    reviewedSourceCommit: REVIEWED_ORDER_DEPLOYMENT.sourceCommit,
    directOrigins: 2,
    redirectOrigins: 1,
    healthy: true,
  });
});

test("rejects an unreviewed deployment before reading Production", async () => {
  let calls = 0;
  await assert.rejects(
    verifyOrderCoreLiveDeployment({
      deploymentId: "dpl_unreviewed",
      fetchFn: () => { calls += 1; return acceptedFetch(""); },
    }),
    /Production deployment binding drifted/,
  );
  assert.equal(calls, 0);
});

test("rejects a direct alias serving an older deployment", async () => {
  await assert.rejects(
    verifyOrderCoreLiveDeployment({
      deploymentId: REVIEWED_ORDER_DEPLOYMENT.id,
      fetchFn: (url) => url === "https://thegrainline.com/"
        ? response(200, "<html>dpl=dpl_old</html>", null, { "content-type": "text/html" })
        : acceptedFetch(url),
    }),
    /not serving the reviewed deployment/,
  );
});

test("rejects unhealthy service state and redirect drift", async (t) => {
  await t.test("health", async () => {
    await assert.rejects(
      verifyOrderCoreLiveDeployment({
        deploymentId: REVIEWED_ORDER_DEPLOYMENT.id,
        fetchFn: (url) => url === "https://grainline.vercel.app/api/health"
          ? response(200, '{"ok":false}', null, {
              "content-type": "application/json",
              "cache-control": "private, no-store",
            })
          : acceptedFetch(url),
      }),
      /health is not accepted/,
    );
  });

  await t.test("redirect", async () => {
    await assert.rejects(
      verifyOrderCoreLiveDeployment({
        deploymentId: REVIEWED_ORDER_DEPLOYMENT.id,
        fetchFn: (url) => url === "https://www.thegrainline.com/"
          ? response(308, "", "https://example.com/")
          : acceptedFetch(url),
      }),
      /redirect target drifted/,
    );
  });
});
