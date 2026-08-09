import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertExactDisabledEndpoint,
  assertSensitiveProductionVariable,
  findProductionEnvironmentVariable,
  normalizeGitHubCiRun,
  parseConfig,
  runStripeConnectBootstrap,
} from "../scripts/stripe-connect-webhook-bootstrap.mjs";

const COMMIT = "a".repeat(40);
const CI_RUN = "31323020529";
const BOOTSTRAP_URL = "https://thegrainline.com/api/stripe/webhook/connect-bootstrap-disabled";
const CANONICAL_URL = "https://thegrainline.com/api/stripe/webhook/connect";
const ENDPOINT_ID = "we_123";
const SIGNING_SECRET = "whsec_test_only_not_a_secret";

function baseEnv(overrides = {}) {
  return {
    STRIPE_CONNECT_BOOTSTRAP_MODE: "bootstrap",
    STRIPE_CONNECT_BOOTSTRAP_CONFIRM: "create-disabled-connect-bootstrap",
    STRIPE_CONNECT_BOOTSTRAP_EXPECTED_COMMIT: COMMIT,
    STRIPE_CONNECT_BOOTSTRAP_CI_RUN_ID: CI_RUN,
    STRIPE_CONNECT_BOOTSTRAP_PROVIDER_MODE: "live",
    STRIPE_CONNECT_BOOTSTRAP_VERCEL_PROJECT_DIRECTORY: "/reviewed/grainline",
    STRIPE_CONNECT_BOOTSTRAP_EVIDENCE_PATH: "archive/stripe-connect-bootstrap-test.json",
    STRIPE_SECRET_KEY: "sk_live_test_only_not_a_secret",
    ...overrides,
  };
}

function absentVercel() {
  return { envs: [] };
}

function sensitiveVercel() {
  return {
    envs: [{
      gitBranch: null,
      key: "STRIPE_CONNECT_WEBHOOK_SECRET",
      target: ["production"],
      type: "sensitive",
    }],
  };
}

function disabledEndpoint(overrides = {}) {
  return {
    enabled_events: ["payout.failed"],
    id: ENDPOINT_ID,
    livemode: true,
    status: "disabled",
    url: BOOTSTRAP_URL,
    ...overrides,
  };
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function successfulDependencies({ calls = [], listVercelEnvironment } = {}) {
  let evidence;
  return {
    calls,
    get evidence() {
      return evidence;
    },
    currentCommit: async () => COMMIT,
    ciRun: async () => ({
      conclusion: "success",
      event: "push",
      headBranch: "main",
      headSha: COMMIT,
      workflowName: "CI",
    }),
    readVercelProject: async () => ({
      orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
      projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
      projectName: "grainline",
    }),
    listVercelEnvironment: listVercelEnvironment || (() => {
      const installed = calls.includes("vercel:add");
      calls.push("vercel:list");
      return installed ? sensitiveVercel() : absentVercel();
    }),
    addVercelEnvironment: async (secret) => {
      assert.equal(secret, SIGNING_SECRET);
      calls.push("vercel:add");
    },
    removeVercelEnvironment: async () => {
      calls.push("vercel:remove");
    },
    listStripeEndpoints: async () => {
      calls.push("stripe:list");
      return [];
    },
    createStripeEndpoint: async () => {
      calls.push("stripe:create");
      return { ...disabledEndpoint({ status: "enabled" }), secret: SIGNING_SECRET };
    },
    disableStripeEndpoint: async (id) => {
      assert.equal(id, ENDPOINT_ID);
      calls.push("stripe:disable");
      return disabledEndpoint();
    },
    retrieveStripeEndpoint: async (id) => {
      assert.equal(id, ENDPOINT_ID);
      calls.push("stripe:retrieve");
      return disabledEndpoint();
    },
    deleteStripeEndpoint: async (id) => {
      calls.push("stripe:delete");
      return { deleted: true, id };
    },
    reserveEvidence: () => {
      calls.push("evidence:reserve");
      return "/tmp/evidence.pending";
    },
    finalizeEvidence: (_pending, _target, payload) => {
      calls.push("evidence:finalize");
      evidence = payload;
    },
    discardEvidence: () => {
      calls.push("evidence:discard");
    },
  };
}

test("parseConfig pins the exact absent and canonical routes", () => {
  const config = parseConfig(baseEnv());
  assert.equal(config.bootstrapUrl, BOOTSTRAP_URL);
  assert.equal(config.canonicalUrl, CANONICAL_URL);
  assert.equal(config.providerMode, "live");
  assert.equal(config.mode, "bootstrap");
});

test("parseConfig refuses bad confirmations, commits and live mutations with test keys", () => {
  assert.throws(
    () => parseConfig(baseEnv({ STRIPE_CONNECT_BOOTSTRAP_CONFIRM: "yes" })),
    /create-disabled-connect-bootstrap/,
  );
  assert.throws(
    () => parseConfig(baseEnv({ STRIPE_CONNECT_BOOTSTRAP_EXPECTED_COMMIT: "abc" })),
    /40-character SHA/,
  );
  assert.throws(
    () => parseConfig(baseEnv({
      STRIPE_CONNECT_BOOTSTRAP_PROVIDER_MODE: "test",
      STRIPE_SECRET_KEY: "sk_test_test_only_not_a_secret",
    })),
    /requires a live Stripe key/,
  );
  assert.throws(
    () => parseConfig(baseEnv({
      STRIPE_CONNECT_BOOTSTRAP_URL: CANONICAL_URL,
    })),
    /reviewed absent route/,
  );
});

test("Vercel helpers require one unbranched Sensitive production variable", () => {
  assert.equal(findProductionEnvironmentVariable(sensitiveVercel()).length, 1);
  assert.equal(assertSensitiveProductionVariable(sensitiveVercel()).type, "sensitive");
  assert.throws(
    () => assertSensitiveProductionVariable({
      envs: [{ key: "STRIPE_CONNECT_WEBHOOK_SECRET", target: ["production"], type: "encrypted" }],
    }),
    /not classified as Sensitive/,
  );
  assert.equal(findProductionEnvironmentVariable({
    envs: [{
      gitBranch: "feature",
      key: "STRIPE_CONNECT_WEBHOOK_SECRET",
      target: ["production"],
      type: "sensitive",
    }],
  }).length, 0);
});

test("GitHub REST run normalization stays bound to the exact repository and run", () => {
  const config = parseConfig(baseEnv());
  const payload = {
    conclusion: "success",
    event: "push",
    head_branch: "main",
    head_sha: COMMIT,
    id: Number(CI_RUN),
    name: "CI",
    repository: { full_name: "Drewyoung910/grainline" },
  };
  assert.deepEqual(normalizeGitHubCiRun(payload, config), {
    conclusion: "success",
    event: "push",
    headBranch: "main",
    headSha: COMMIT,
    workflowName: "CI",
  });
  assert.throws(
    () => normalizeGitHubCiRun({ ...payload, id: Number(CI_RUN) + 1 }, config),
    /different run or repository/,
  );
  assert.throws(
    () => normalizeGitHubCiRun({ ...payload, repository: { full_name: "other/repo" } }, config),
    /different run or repository/,
  );
});

test("endpoint proof rejects an enabled endpoint or expanded event set", () => {
  const config = parseConfig(baseEnv());
  assert.equal(assertExactDisabledEndpoint(disabledEndpoint(), config).id, ENDPOINT_ID);
  assert.throws(
    () => assertExactDisabledEndpoint(disabledEndpoint({ status: "enabled" }), config),
    /exact reviewed disabled bootstrap state/,
  );
  assert.throws(
    () => assertExactDisabledEndpoint(disabledEndpoint({ enabled_events: ["payout.failed", "*"] }), config),
    /exact reviewed disabled bootstrap state/,
  );
});

test("preflight proves exact boundaries without creating provider state", async () => {
  const calls = [];
  const dependencies = successfulDependencies({ calls });
  const result = await runStripeConnectBootstrap({
    env: baseEnv({
      STRIPE_CONNECT_BOOTSTRAP_MODE: "preflight",
      STRIPE_CONNECT_BOOTSTRAP_CONFIRM: "inspect-disabled-connect-bootstrap",
      STRIPE_CONNECT_BOOTSTRAP_PROVIDER_MODE: "test",
      STRIPE_SECRET_KEY: "sk_test_test_only_not_a_secret",
    }),
    dependencies,
  });
  assert.equal(result.status, "passed");
  assert.equal(result.mode, "preflight");
  assert.deepEqual(calls, ["vercel:list", "stripe:list"]);
});

test("bootstrap disables before secret installation and writes secret-free evidence", async () => {
  const calls = [];
  const dependencies = successfulDependencies({ calls });
  const result = await runStripeConnectBootstrap({ env: baseEnv(), dependencies });
  assert.equal(result.status, "passed");
  assert.deepEqual(calls, [
    "vercel:list",
    "stripe:list",
    "evidence:reserve",
    "stripe:create",
    "stripe:disable",
    "stripe:retrieve",
    "vercel:add",
    "vercel:list",
    "evidence:finalize",
  ]);
  const serialized = JSON.stringify(dependencies.evidence);
  assert.doesNotMatch(serialized, /whsec_/);
  assert.doesNotMatch(serialized, /sk_live_/);
  assert.equal(dependencies.evidence.stripe.signingSecretPersistedInEvidence, false);
  assert.equal(dependencies.evidence.stripe.connectedAccountSourceRequestedAtCreation, true);
  assert.equal(dependencies.evidence.nextBoundary, "deploy compatible app while the Stripe endpoint remains disabled");
});

test("existing bootstrap or canonical endpoint stops before reservation", async () => {
  const calls = [];
  const dependencies = successfulDependencies({ calls });
  dependencies.listStripeEndpoints = async () => {
    calls.push("stripe:list");
    return [disabledEndpoint({ url: CANONICAL_URL })];
  };
  await assert.rejects(
    runStripeConnectBootstrap({ env: baseEnv(), dependencies }),
    /already occupies/,
  );
  assert.deepEqual(calls, ["vercel:list", "stripe:list"]);
});

test("disable failure deletes the exact endpoint and never sends the signing secret", async () => {
  const calls = [];
  const dependencies = successfulDependencies({ calls });
  dependencies.disableStripeEndpoint = async () => {
    calls.push("stripe:disable");
    throw new Error("disable failed");
  };
  await assert.rejects(
    runStripeConnectBootstrap({ env: baseEnv(), dependencies }),
    /disable failed; rollback completed/,
  );
  assert.equal(calls.includes("vercel:add"), false);
  assert.equal(calls.includes("stripe:delete"), true);
  assert.equal(calls.at(-1), "evidence:discard");
});

test("ambiguous Vercel add failure reconciles and removes a possibly installed secret", async () => {
  const calls = [];
  let listCount = 0;
  const dependencies = successfulDependencies({
    calls,
    listVercelEnvironment: async () => {
      listCount += 1;
      calls.push("vercel:list");
      if (listCount === 1 || listCount === 3) return absentVercel();
      return sensitiveVercel();
    },
  });
  dependencies.addVercelEnvironment = async () => {
    calls.push("vercel:add");
    throw new Error("transport ended after request");
  };
  await assert.rejects(
    runStripeConnectBootstrap({ env: baseEnv(), dependencies }),
    /transport ended after request; rollback completed/,
  );
  assert.deepEqual(calls.slice(-5), [
    "vercel:list",
    "vercel:remove",
    "vercel:list",
    "stripe:delete",
    "evidence:discard",
  ]);
});

test("Vercel classification failure removes the secret and endpoint", async () => {
  const calls = [];
  let listCount = 0;
  const dependencies = successfulDependencies({
    calls,
    listVercelEnvironment: async () => {
      listCount += 1;
      calls.push("vercel:list");
      if (listCount === 1 || listCount === 4) return absentVercel();
      if (listCount === 2) {
        return { envs: [{ key: "STRIPE_CONNECT_WEBHOOK_SECRET", target: ["production"], type: "encrypted" }] };
      }
      return sensitiveVercel();
    },
  });
  await assert.rejects(
    runStripeConnectBootstrap({ env: baseEnv(), dependencies }),
    /not classified as Sensitive; rollback completed/,
  );
  assert.equal(calls.includes("vercel:remove"), true);
  assert.equal(calls.includes("stripe:delete"), true);
});

test("ambiguous create failure reconciles only one exact bootstrap candidate", async () => {
  const calls = [];
  let stripeListCount = 0;
  const dependencies = successfulDependencies({ calls });
  dependencies.listStripeEndpoints = async () => {
    stripeListCount += 1;
    calls.push("stripe:list");
    return stripeListCount === 1 ? [] : [disabledEndpoint()];
  };
  dependencies.createStripeEndpoint = async () => {
    calls.push("stripe:create");
    throw new Error("ambiguous create transport failure");
  };
  await assert.rejects(
    runStripeConnectBootstrap({ env: baseEnv(), dependencies }),
    /ambiguous create transport failure; rollback completed/,
  );
  assert.equal(calls.includes("stripe:delete"), true);
  assert.equal(calls.includes("vercel:add"), false);
});

test("operator source pins Connect scope and never passes the signing secret as an argument", () => {
  const source = readFileSync("scripts/stripe-connect-webhook-bootstrap.mjs", "utf8");
  assert.match(source, /connect: true/);
  assert.match(source, /enabled_events: \[REQUIRED_EVENT\]/);
  assert.match(source, /disabled: true/);
  assert.match(source, /input: `\$\{secret\}\\n`/);
  assert.doesNotMatch(source, /"--value"/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /flag: "wx"/);
  assert.match(source, /vercel@\$\{VERCEL_CLI_VERSION\}/);
  assert.match(source, /api\.github\.com\/repos\/\$\{REPOSITORY\}\/actions\/runs/);
  assert.doesNotMatch(source, /\["run", "view"/);
});

test("package and durable provider records retain the operator boundary", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const operator = normalizeWhitespace(
    readFileSync("docs/stripe-connect-webhook-bootstrap-operator.md", "utf8"),
  );
  const topology = normalizeWhitespace(
    readFileSync("docs/stripe-webhook-provider-topology-audit.md", "utf8"),
  );
  const securityLog = normalizeWhitespace(readFileSync("docs/security-audit-log.md", "utf8"));
  assert.equal(
    pkg.scripts["ops:stripe-connect-bootstrap"],
    "node scripts/stripe-connect-webhook-bootstrap.mjs",
  );
  assert.match(operator, /Status: prepared and tested; never executed/);
  assert.match(operator, /immediately disables the endpoint and retrieves it again/);
  assert.match(operator, /removes a possibly installed variable/);
  assert.match(operator, /does not depend on the workstation's mutable `gh` authentication state/);
  assert.match(operator, /Preparation of this operator is not authorization to execute it/);
  assert.match(topology, /stripe-connect-webhook-bootstrap-operator\.md/);
  assert.match(securityLog, /PR #170.*31323020529.*preparation only/);
});
