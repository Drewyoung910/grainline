import { request as httpsRequest } from "node:https";
import { r2GitHubReceiptScope, receiveR2GitHubConsumerProof } from "./r2-github-consumer-receiver.mjs";

const FAIL = "R2 GitHub transport refused; no authorization or download URL disclosed.";
const check = value => { if (!value) throw new Error(FAIL); };
const PREFIX = "/repos/Drewyoung910/grainline";
const KEYS = ["ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET_NAME", "PUBLIC_URL"].map(key => "CLOUDFLARE_R2_" + key);

export function makeR2GitHubConsumerTransport({ scope: supplied, token, request = httpsRequest }) {
  const scope = r2GitHubReceiptScope(supplied);
  check(typeof token === "string" && /^[A-Za-z0-9_]{20,512}$/.test(token));
  const get = (url, authenticated, redirect, signal) => new Promise((resolve, reject) => {
    let settled = false, size = 0; const chunks = [];
    const fail = () => { if (!settled) { settled = true; chunks.forEach(chunk => chunk.fill(0)); reject(new Error(FAIL)); } };
    const headers = authenticated ? { authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28", "user-agent": "grainline-r2-consumer-receiver" } : { "user-agent": "grainline-r2-consumer-receiver" };
    const req = request(url, { method: "GET", headers, agent: false, signal }, response => {
      if (redirect && response.statusCode === 302) {
        const location = response.headers.location;
        settled = true; response.destroy(); resolve({ location }); return;
      }
      if (response.statusCode !== 200 || redirect) { fail(); response.destroy(); return; }
      response.on("error", fail); response.on("aborted", fail);
      response.on("data", chunk => {
        if (settled) return;
        size += chunk.length;
        if (size > (authenticated ? 1048576 : 262144)) { fail(); response.destroy(); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        if (settled) return;
        const bytes = Buffer.concat(chunks);
        try {
          signal.throwIfAborted();
          const value = authenticated ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) : Buffer.from(bytes);
          settled = true; resolve(value);
        } catch { fail(); }
        finally { bytes.fill(0); chunks.forEach(chunk => chunk.fill(0)); }
      });
      response.on("close", () => { if (!response.complete) fail(); });
    });
    req.on("error", fail); req.end();
  });
  return async (operation, key, { signal } = {}) => {
    try {
      let path;
      check(key === undefined || operation === "secret" && KEYS.includes(key));
      switch (operation) {
        case "run": path = `${PREFIX}/actions/runs/${scope.runId}`; break;
        case "jobs": path = `${PREFIX}/actions/runs/${scope.runId}/attempts/${scope.runAttempt}/jobs?per_page=100`; break;
        case "artifact": path = `${PREFIX}/actions/artifacts/${scope.artifactId}`; break;
        case "archive": path = `${PREFIX}/actions/artifacts/${scope.artifactId}/zip`; break;
        case "workflow": path = `${PREFIX}/contents/.github/workflows/r2-application-consumer-proof.yml?ref=${scope.commitSha}`; break;
        case "script": path = `${PREFIX}/contents/scripts/r2-application-github-consumer-proof.mjs?ref=${scope.commitSha}`; break;
        case "secret": check(KEYS.includes(key)); path = `${PREFIX}/actions/secrets/${key}`; break;
        default: check(false);
      }
      const bounded = AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]); bounded.throwIfAborted();
      const result = await get(new URL(path, "https://api.github.com"), true, operation === "archive", bounded);
      if (operation !== "archive") return result;
      check(typeof result.location === "string" && result.location.length <= 8192);
      const location = new URL(result.location);
      check(location.protocol === "https:" && !location.username && !location.password && !location.port && !location.hash
        && (location.hostname.endsWith(".blob.core.windows.net") || location.hostname.endsWith(".actions.githubusercontent.com")));
      // Exactly one validated storage redirect. Never forward GitHub credentials.
      return await get(location, false, false, bounded);
    } catch { throw new Error(FAIL); }
  };
}

export async function receiveR2GitHubConsumerWithAuthorization({ scope, withAuthorization, enabled = false, signal, clock = Date.now, request = httpsRequest }) {
  try {
    check(enabled === true && typeof withAuthorization === "function"); let entered = false, receipt;
    const start = clock(); check(Number.isSafeInteger(start) && start > 0);
    const bounded = AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]); bounded.throwIfAborted();
    await withAuthorization(async token => {
      check(!entered); entered = true;
      receipt = await receiveR2GitHubConsumerProof({ enabled, scope, read: makeR2GitHubConsumerTransport({ scope, token, request }), signal: bounded, clock });
    }, { signal: bounded });
    const finish = clock();
    check(entered && receipt && Number.isSafeInteger(finish) && finish >= start && finish - start <= 45000);
    bounded.throwIfAborted(); return receipt;
  } catch { throw new Error(FAIL); }
}
