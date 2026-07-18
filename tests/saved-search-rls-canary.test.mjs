import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseSavedSearchRlsCanaryConfiguration,
  runSavedSearchRlsCanary,
} from "../src/lib/savedSearchRlsCanary.ts";

const NONCE = "0123456789abcdef";
const USER_ID = `rls-saved-search-canary-${NONCE}-user`;
const SEARCH_ID = `rls-saved-search-canary-${NONCE}-search`;
const VALID_ENV = {
  SAVED_SEARCH_RLS_CANARY_USER_ID: USER_ID,
  SAVED_SEARCH_RLS_CANARY_SEARCH_ID: SEARCH_ID,
};

describe("SavedSearch RLS silent-denial canary", () => {
  it("requires one valid paired synthetic configuration", () => {
    assert.deepEqual(parseSavedSearchRlsCanaryConfiguration({}), {
      result: { issueCount: 1, status: "configuration_missing" },
    });
    assert.deepEqual(
      parseSavedSearchRlsCanaryConfiguration({
        SAVED_SEARCH_RLS_CANARY_USER_ID: USER_ID,
      }),
      { result: { issueCount: 1, status: "configuration_partial" } },
    );

    for (const env of [
      {
        SAVED_SEARCH_RLS_CANARY_USER_ID: `rls-saved-search-canary-${NONCE}-user `,
        SAVED_SEARCH_RLS_CANARY_SEARCH_ID: SEARCH_ID,
      },
      {
        SAVED_SEARCH_RLS_CANARY_USER_ID: "customer_user_123",
        SAVED_SEARCH_RLS_CANARY_SEARCH_ID: SEARCH_ID,
      },
      {
        SAVED_SEARCH_RLS_CANARY_USER_ID: USER_ID,
        SAVED_SEARCH_RLS_CANARY_SEARCH_ID:
          "rls-saved-search-canary-fedcba9876543210-search",
      },
    ]) {
      assert.deepEqual(parseSavedSearchRlsCanaryConfiguration(env), {
        result: { issueCount: 1, status: "configuration_invalid" },
      });
    }

    assert.deepEqual(parseSavedSearchRlsCanaryConfiguration(VALID_ENV), {
      userId: USER_ID,
      searchId: SEARCH_ID,
    });
  });

  it("reports one bounded issue for zero, duplicate, wrong, invalid, or failed lookups", async () => {
    const cases = [
      [{ exactMatch: false, matchCount: 0 }, "not_found"],
      [{ exactMatch: false, matchCount: 2 }, "duplicate"],
      [{ exactMatch: false, matchCount: 1 }, "wrong_row"],
      [{ exactMatch: true, matchCount: -1 }, "invalid_result"],
      [{ exactMatch: true, matchCount: Number.NaN }, "invalid_result"],
      [{ exactMatch: "yes", matchCount: 1 }, "invalid_result"],
    ];

    for (const [lookupResult, status] of cases) {
      const result = await runSavedSearchRlsCanary(VALID_ENV, async (config) => {
        assert.deepEqual(config, { userId: USER_ID, searchId: SEARCH_ID });
        return lookupResult;
      });
      assert.deepEqual(result, { issueCount: 1, status });
      assert.doesNotMatch(JSON.stringify(result), new RegExp(USER_ID));
      assert.doesNotMatch(JSON.stringify(result), new RegExp(SEARCH_ID));
    }

    const secretError = `driver failed for ${USER_ID} and ${SEARCH_ID}`;
    const failed = await runSavedSearchRlsCanary(VALID_ENV, async () => {
      throw new Error(secretError);
    });
    assert.deepEqual(failed, { issueCount: 1, status: "query_failed" });
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(USER_ID));
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(SEARCH_ID));
    assert.doesNotMatch(JSON.stringify(failed), /driver failed/);
  });

  it("fails closed before lookup when configuration is missing or invalid", async () => {
    let lookupCalls = 0;
    const lookup = async () => {
      lookupCalls += 1;
      return { exactMatch: true, matchCount: 1 };
    };

    assert.deepEqual(await runSavedSearchRlsCanary({}, lookup), {
      issueCount: 1,
      status: "configuration_missing",
    });
    assert.deepEqual(
      await runSavedSearchRlsCanary(
        { SAVED_SEARCH_RLS_CANARY_USER_ID: USER_ID },
        lookup,
      ),
      { issueCount: 1, status: "configuration_partial" },
    );
    assert.deepEqual(
      await runSavedSearchRlsCanary(
        {
          SAVED_SEARCH_RLS_CANARY_USER_ID: USER_ID,
          SAVED_SEARCH_RLS_CANARY_SEARCH_ID: "customer-search-id",
        },
        lookup,
      ),
      { issueCount: 1, status: "configuration_invalid" },
    );
    assert.equal(lookupCalls, 0);
  });

  it("is healthy only for the one exact owner-context row", async () => {
    const result = await runSavedSearchRlsCanary(VALID_ENV, async (config) => {
      assert.deepEqual(config, { userId: USER_ID, searchId: SEARCH_ID });
      return { exactMatch: true, matchCount: 1 };
    });

    assert.deepEqual(result, { issueCount: 0, status: "healthy" });
  });

  it("uses the normal owner-context access path and retains only safe telemetry", () => {
    const access = readFileSync("src/lib/savedSearchOwnerAccess.ts", "utf8");
    const route = readFileSync("src/app/api/cron/ops-health/route.ts", "utf8");
    const runbook = readFileSync("docs/runbook.md", "utf8");
    const launch = readFileSync("docs/launch-checklist.md", "utf8");
    const envExample = readFileSync(".env.example", "utf8");

    assert.match(access, /export async function inspectOwnerSavedSearchCanary/);
    assert.match(access, /listOwnerSavedSearches\(userId, db, \{ take: 2, searchId \}\)/);
    assert.match(access, /public\.grainline_saved_search_list/);
    assert.match(route, /inspectOwnerSavedSearchCanary\(userId, searchId, prisma\)/);
    assert.match(route, /savedSearchRlsCanaryIssueCount: savedSearchRlsCanary\.issueCount/);
    assert.match(route, /savedSearchRlsCanaryStatus: savedSearchRlsCanary\.status/);

    const sentryStart = route.indexOf(
      'Sentry.captureMessage("Ops health check found actionable issues"',
    );
    const sentryEnd = route.indexOf("const response", sentryStart);
    assert.notEqual(sentryStart, -1);
    assert.notEqual(sentryEnd, -1);
    const sentryBlock = route.slice(sentryStart, sentryEnd);
    assert.match(sentryBlock, /savedSearchRlsCanaryStatus/);
    assert.doesNotMatch(sentryBlock, /SAVED_SEARCH_RLS_CANARY_(USER|SEARCH)_ID/);
    assert.doesNotMatch(sentryBlock, /savedSearchRlsCanary(User|Search)Id/);

    assert.match(envExample, /SAVED_SEARCH_RLS_CANARY_USER_ID=/);
    assert.match(envExample, /SAVED_SEARCH_RLS_CANARY_SEARCH_ID=/);
    assert.match(runbook, /permanent non-customer `SavedSearch` canary pair/);
    assert.match(runbook, /never attaches the ids/);
    assert.match(launch, /savedSearchRlsCanaryStatus=healthy/);
    assert.match(launch, /never attaches canary ids/);
  });
});
