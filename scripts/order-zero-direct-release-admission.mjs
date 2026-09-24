// Live GitHub serialization observation, not a caller-supplied "locked" flag.
// No workflow is installed or dispatched by this component. The trusted job
// must actually run under the shared workflow-level concurrency group.
import assert from "node:assert/strict";
import fs from "node:fs";

const REPOSITORY = "Drewyoung910/grainline";
// The historical migration workflow can run unrelated migrations and must
// never authorize the isolated Order zero-direct worker.
const MODES = Object.freeze({
  inspect: Object.freeze({ workflow: ".github/workflows/order-zero-direct-production.yml",
    job: "Inspect Order zero-direct production scope" }),
  execute: Object.freeze({ workflow: ".github/workflows/order-zero-direct-execute.yml",
    job: "Execute reviewed Order zero-direct prefix" }),
});
function selectedMode(mode) {
  assert.ok(Object.hasOwn(MODES, mode));
  return MODES[mode];
}
export const ORDER_RELEASE_SERIALIZATION_GROUP = "production-database-migrations";
const positiveId = value => typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value)
  && Number.isSafeInteger(Number(value));

async function read(resource, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let reader;
  try {
    const url = `https://api.github.com/repos/${REPOSITORY}/${resource}`;
    const response = await fetch(url, { method: "GET", redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    assert.ok(response.status === 200 && !response.redirected && response.body);
    if (response.url) assert.equal(response.url, url);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:\s*;|$)/iu);
    reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    while (true) {
      const result = await reader.read(); if (result.done) break;
      bytes += result.value.byteLength; assert.ok(bytes <= 1024 * 1024); chunks.push(result.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timer); controller.abort();
    if (reader) { try { await reader.cancel(); } catch { /* Sanitized by caller. */ } }
  }
}

// A workflow_dispatch caller cannot know its numeric job ID before GitHub
// starts the job. Discover exactly the one running job for this run attempt;
// the existing admission observer then re-reads that ID twice independently.
export async function discoverOrderReleaseJobId({ releaseCommit, runId, runAttempt,
  runnerName, githubToken, mode = "inspect" }) {
  try {
    const { job: expectedJob } = selectedMode(mode);
    assert.match(releaseCommit, /^[a-f0-9]{40}$/u);
    assert.ok(positiveId(runId) && positiveId(runAttempt));
    assert.ok(typeof runnerName === "string" && runnerName.length > 0 && runnerName.length <= 256);
    assert.match(githubToken, /^[\x21-\x7e]{8,4096}$/u);
    const result = await read(`actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`, githubToken);
    assert.ok(result && result.total_count === 1 && Array.isArray(result.jobs) && result.jobs.length === 1);
    const job = result.jobs[0];
    assert.ok(job && positiveId(String(job.id)) && String(job.run_id) === runId
      && String(job.run_attempt) === runAttempt && job.head_sha === releaseCommit
      && job.status === "in_progress" && job.conclusion === null && job.name === expectedJob
      && job.runner_name === runnerName && Number.isSafeInteger(job.runner_id) && job.runner_id > 0);
    return String(job.id);
  } catch { throw new Error("Order running job identity unavailable; no execution admission"); }
}

export async function observeOrderReleaseAdmission({ releaseCommit, admission, githubToken, mode = "inspect" }) {
  try {
    const { workflow: expectedWorkflow, job: expectedJob } = selectedMode(mode);
    assert.deepEqual(Object.keys(admission).sort(), ["jobId", "runAttempt", "runId"]);
    for (const value of Object.values(admission)) assert.ok(typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value)));
    assert.match(releaseCommit, /^[a-f0-9]{40}$/u);
    assert.match(githubToken, /^[\x21-\x7e]{8,4096}$/u);
    assert.ok(!Object.keys(process.env).some(key => /^(?:NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|ALL_PROXY)$/iu.test(key)));
    // Exact top-level stanza of the tracked, source-fenced workflow. Reject
    // duplicate keys/anchors/expressions rather than guessing YAML semantics.
    const workflow = fs.readFileSync(expectedWorkflow, "utf8");
    assert.equal(workflow.match(/^concurrency:/gmu)?.length, 1);
    assert.match(workflow, /^concurrency:\n  group: production-database-migrations\n  cancel-in-progress: false\n\njobs:\n/mu);
    assert.equal(workflow.match(/^  group:/gmu)?.length, 1);
    assert.equal(workflow.match(/^  cancel-in-progress:/gmu)?.length, 1);
    for (let pass = 0; pass < 2; pass++) {
      const run = await read(`actions/runs/${admission.runId}`, githubToken);
      assert.ok(String(run.id) === admission.runId && String(run.run_attempt) === admission.runAttempt
        && run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY
        && run.head_sha === releaseCommit && run.head_branch === "main" && run.event === "workflow_dispatch"
        && run.path === expectedWorkflow && run.status === "in_progress" && run.conclusion === null);
      const job = await read(`actions/jobs/${admission.jobId}`, githubToken);
      assert.ok(String(job.id) === admission.jobId && String(job.run_id) === admission.runId
        && String(job.run_attempt) === admission.runAttempt && job.head_sha === releaseCommit
        && job.status === "in_progress" && job.conclusion === null
        && job.name === expectedJob && Number.isSafeInteger(job.runner_id) && job.runner_id > 0);
    }
    return Object.freeze({ group: ORDER_RELEASE_SERIALIZATION_GROUP, cancelInProgress: false,
      productionExecutionAuthorized: false });
  } catch { throw new Error("Order global migration admission lost or unavailable"); }
}
