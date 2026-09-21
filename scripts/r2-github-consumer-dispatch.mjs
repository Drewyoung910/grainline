import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { r2GitHubReceiptScope } from "./r2-github-consumer-receiver.mjs";
import { receiveR2GitHubConsumerWithAuthorization } from "./r2-github-consumer-transport.mjs";
import { withR2GitHubDispatchJournal } from "./r2-github-dispatch-journal.mjs";

const FAIL = "R2 GitHub dispatch refused; inspect the saved intent before any further dispatch.";
const check = value => { if (!value) throw new Error(FAIL); };
const REPO = "Drewyoung910/grainline", PREFIX = `/repos/${REPO}`;
const WORKFLOW = ".github/workflows/r2-application-consumer-proof.yml";
const SCRIPT = "scripts/r2-application-github-consumer-proof.mjs";
const KEYS = ["ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET_NAME", "PUBLIC_URL"].map(key => "CLOUDFLARE_R2_" + key);
const FIELDS = ["repositoryId", "workflowId", "actorId", "commitSha", "workflowSha256", "scriptSha256", "nonce", "snapshotSha256", "capturedAt", "pairSha256", "valueSha256"];
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const positive = value => Number.isSafeInteger(value) && value > 0;
const iso = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const stamp = clock => { const now = clock(); check(positive(now)); return now; };
const reviewValue = value => {
  check(exact(value, FIELDS) && iso(value.capturedAt));
  // Share the receiver's shape/hash/id validation without inventing real run IDs.
  r2GitHubReceiptScope({ ...value, runId: 1, runAttempt: 1, artifactId: 1, dispatchedAt: value.capturedAt,
    secretMetadata: Object.fromEntries(KEYS.map(key => [key, { created_at: value.capturedAt, updated_at: value.capturedAt }])) });
  return structuredClone(value);
};
const reviewInput = review => Object.fromEntries(["nonce", "commitSha", "snapshotSha256", "capturedAt", "pairSha256", "valueSha256"].map(key => [key, review[key]]));

// Closed endpoint set; exactly one request per call, no redirects or retries.
export function makeR2GitHubDispatchTransport({ review: supplied, token, request = httpsRequest }) {
  const review = reviewValue(supplied);
  check(typeof token === "string" && /^[A-Za-z0-9_]{20,512}$/.test(token));
  return async (operation, key, { signal } = {}) => {
    try {
      check(key === undefined || operation === "secret" && KEYS.includes(key));
      let path;
      switch (operation) {
        case "repository": path = PREFIX; break;
        case "actor": path = "/user"; break;
        case "main": path = PREFIX + "/git/ref/heads/main"; break;
        case "workflow": path = `${PREFIX}/actions/workflows/${review.workflowId}`; break;
        case "workflowSource": path = `${PREFIX}/contents/${WORKFLOW}?ref=${review.commitSha}`; break;
        case "scriptSource": path = `${PREFIX}/contents/${SCRIPT}?ref=${review.commitSha}`; break;
        case "secret": check(KEYS.includes(key)); path = `${PREFIX}/actions/secrets/${key}`; break;
        case "dispatch": path = `${PREFIX}/actions/workflows/${review.workflowId}/dispatches`; break;
        default: check(false);
      }
      const bounded = AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]); bounded.throwIfAborted();
      const body = operation === "dispatch" ? JSON.stringify({ ref: "main", return_run_details: true, inputs: {
        release_commit: review.commitSha, confirmation: "prove-reviewed-r2-application-consumer", review_json: JSON.stringify(reviewInput(review)),
      } }) : undefined;
      return await new Promise((resolve, reject) => {
        let settled = false, size = 0; const chunks = [];
        const fail = () => { if (!settled) { settled = true; chunks.forEach(chunk => chunk.fill(0)); reject(new Error(FAIL)); } };
        const req = request(new URL(path, "https://api.github.com"), {
          method: body ? "POST" : "GET", agent: false, signal: bounded,
          headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28",
            "user-agent": "grainline-r2-consumer-dispatch", ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}) },
        }, response => {
          if (response.statusCode !== 200 && !(operation === "dispatch" && response.statusCode === 204)) { fail(); response.destroy(); return; }
          response.on("error", fail); response.on("aborted", fail);
          response.on("data", chunk => {
            if (settled) return; size += chunk.length;
            if (size > (operation === "dispatch" ? 4096 : 131072)) { fail(); response.destroy(); return; }
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () => {
            if (settled) return; const bytes = Buffer.concat(chunks);
            try {
              bounded.throwIfAborted(); check(response.complete);
              const value = response.statusCode === 204 ? null : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
              check(response.statusCode !== 204 || bytes.length === 0);
              settled = true; resolve(operation === "dispatch" ? { status: response.statusCode, value } : value);
            } catch { fail(); }
            finally { bytes.fill(0); chunks.forEach(chunk => chunk.fill(0)); }
          });
          response.on("close", () => { if (!response.complete) fail(); });
        });
        req.on("error", fail); req.end(body);
      });
    } catch { throw new Error(FAIL); }
  };
}

// No CLI or implicit credentials. The caller supplies reviewed hashes and a
// narrowly scoped authorization callback. The durable intent precedes the POST.
export async function dispatchR2GitHubConsumer({ enabled = false, directory, review: supplied, withAuthorization,
  request = httpsRequest, clock = Date.now, signal }) {
  try {
    check(enabled === true && typeof withAuthorization === "function"); const review = reviewValue(supplied);
    const start = stamp(clock), bounded = AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]);
    const fresh = () => { bounded.throwIfAborted(); const now = stamp(clock);
      check(now >= start && now - start <= 45000 && now >= Date.parse(review.capturedAt) && now - Date.parse(review.capturedAt) <= 300000); return now; };
    fresh();
    return await withR2GitHubDispatchJournal(directory, async journal => {
      check(journal.read("intent") === null && journal.read("acknowledgement") === null && journal.read("receipt") === null);
      let entered = false, acknowledgement;
      await withAuthorization(async token => {
        check(!entered); entered = true; fresh();
        const transport = makeR2GitHubDispatchTransport({ review, token, request });
        const call = async (op, key) => { fresh(); const value = await transport(op, key, { signal: bounded }); fresh(); return value; };
        const repo = await call("repository"), actor = await call("actor"), workflow = await call("workflow");
        check(repo.id === review.repositoryId && repo.full_name === REPO && repo.default_branch === "main" && repo.archived === false
          && actor.id === review.actorId && workflow.id === review.workflowId && workflow.path === WORKFLOW && workflow.state === "active");
        for (const [op, path, digest] of [["workflowSource", WORKFLOW, review.workflowSha256], ["scriptSource", SCRIPT, review.scriptSha256]]) {
          const source = await call(op);
          check(source.type === "file" && source.path === path && source.encoding === "base64" && typeof source.content === "string"
            && source.content.length <= 100000 && positive(source.size) && source.size <= 65536);
          const bytes = Buffer.from(source.content, "base64"); check(bytes.length === source.size && hash(bytes) === digest);
        }
        const secretMetadata = {};
        for (const key of KEYS) {
          const row = await call("secret", key); check(row.name === key && typeof row.created_at === "string" && typeof row.updated_at === "string");
          secretMetadata[key] = { created_at: row.created_at, updated_at: row.updated_at };
        }
        const main = await call("main"); check(main.ref === "refs/heads/main" && main.object?.type === "commit" && main.object.sha === review.commitSha);
        const dispatchedAt = new Date(fresh()).toISOString();
        r2GitHubReceiptScope({ ...review, secretMetadata, dispatchedAt, runId: 1, runAttempt: 1, artifactId: 1 });
        journal.write("intent", { schemaVersion: 1, operation: "r2-github-dispatch-intent", review, secretMetadata, dispatchedAt });
        // From this point every failure is potentially a dispatched run. No retry.
        const response = await call("dispatch");
        let runId = null;
        if (response.status === 200) {
          check(exact(response.value, ["workflow_run_id", "run_url", "html_url"]) && positive(response.value.workflow_run_id));
          runId = response.value.workflow_run_id;
          check(response.value.run_url === `https://api.github.com${PREFIX}/actions/runs/${runId}`
            && response.value.html_url === `https://github.com/${REPO}/actions/runs/${runId}`);
        } else check(response.status === 204 && response.value === null);
        acknowledgement = { schemaVersion: 1, operation: "r2-github-dispatch-acknowledgement", nonce: review.nonce,
          status: response.status, runId, acknowledgedAt: new Date(fresh()).toISOString(), providerRunProvenanceVerified: false };
      }, { signal: bounded });
      fresh(); check(entered && acknowledgement);
      journal.write("acknowledgement", acknowledgement); return acknowledgement;
    });
  } catch { throw new Error(FAIL); }
}

// A response-loss recovery never POSTs. Explicit IDs are only search coordinates;
// the existing native receiver must bind source, metadata, job, archive and nonce.
export async function recoverR2GitHubConsumerDispatch({ enabled = false, directory, runId, artifactId,
  withAuthorization, request = httpsRequest, clock = Date.now, signal }) {
  try {
    check(enabled === true && positive(runId) && positive(artifactId));
    return await withR2GitHubDispatchJournal(directory, async journal => {
      check(journal.read("receipt") === null);
      const intent = journal.read("intent"), acknowledgement = journal.read("acknowledgement");
      check(exact(intent, ["schemaVersion", "operation", "review", "secretMetadata", "dispatchedAt"])
        && intent.schemaVersion === 1 && intent.operation === "r2-github-dispatch-intent" && iso(intent.dispatchedAt));
      const review = reviewValue(intent.review);
      if (acknowledgement !== null) {
        check(exact(acknowledgement, ["schemaVersion", "operation", "nonce", "status", "runId", "acknowledgedAt", "providerRunProvenanceVerified"])
          && acknowledgement.schemaVersion === 1 && acknowledgement.operation === "r2-github-dispatch-acknowledgement"
          && acknowledgement.nonce === review.nonce && acknowledgement.providerRunProvenanceVerified === false
          && iso(acknowledgement.acknowledgedAt) && Date.parse(acknowledgement.acknowledgedAt) >= Date.parse(intent.dispatchedAt)
          && (acknowledgement.status === 200 && acknowledgement.runId === runId || acknowledgement.status === 204 && acknowledgement.runId === null));
      }
      const scope = r2GitHubReceiptScope({ ...review, secretMetadata: intent.secretMetadata,
        dispatchedAt: intent.dispatchedAt, runId, runAttempt: 1, artifactId });
      const receipt = await receiveR2GitHubConsumerWithAuthorization({ enabled, scope, withAuthorization, request, clock, signal });
      journal.write("receipt", receipt); return receipt;
    });
  } catch { throw new Error(FAIL); }
}
