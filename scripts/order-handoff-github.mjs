// One bounded attempt-job discovery. The worker independently revalidates it.
import assert from "node:assert/strict";
import { id, REPO } from "./order-handoff-common.mjs";

export async function discoverOrderHandoffJob({ context, githubToken }, request = fetch) {
  id(context.runId); id(context.runAttempt);
  assert.match(githubToken, /^[\x21-\x7e]{8,4096}$/u);
  const url = `https://api.github.com/repos/${REPO}/actions/runs/${context.runId}/attempts/${context.runAttempt}/jobs?per_page=100`;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  let reader;
  try {
    const result = await request(url, { method: "GET", redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" } });
    assert.ok(result.status === 200 && !result.redirected && result.body);
    if (result.url) assert.equal(result.url, url);
    assert.match(result.headers.get("content-type") ?? "", /^application\/json(?:\s*;|$)/iu);
    assert.equal(result.headers.get("link"), null); // The reviewed workflow has one non-matrix job.
    reader = result.body.getReader(); const chunks = []; let bytes = 0;
    while (true) { const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; assert.ok(bytes <= 1024 * 1024); chunks.push(part.value); }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.total_count, 1); assert.equal(body.jobs.length, 1);
    const job = body.jobs[0]; id(String(job.id));
    assert.ok(String(job.run_id) === context.runId && String(job.run_attempt) === context.runAttempt
      && job.head_sha === context.releaseCommit && job.name === "Guarded production migration"
      && job.status === "in_progress" && job.conclusion === null && job.runner_name === context.runnerName
      && Number.isSafeInteger(job.runner_id) && job.runner_id > 0);
    return Object.freeze({ runId: context.runId, runAttempt: context.runAttempt, jobId: String(job.id) });
  } catch { throw new Error("Order handoff job discovery failed; no retry"); }
  finally { clearTimeout(timeout); controller.abort(); if (reader) { try { await reader.cancel(); } catch { /* No raw responses. */ } } }
}
