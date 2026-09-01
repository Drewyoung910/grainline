#!/usr/bin/env node
// Exact-claim recovery for a Shippo response that became ambiguous after the
// carrier request. Ordinary runtime cannot call the owner-only read/release
// functions. Review/merge does not authorize execution.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import pg from "pg";
import Stripe from "stripe";
import {
  parseVercelRuntimeDatabaseIdentity,
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CONFIRMATION =
  "reconcile-one-reviewed-ambiguous-order-label-claim";
export const ORDER_LABEL_AMBIGUOUS_EVIDENCE_DIRECTORY =
  "/Users/drewyoung/grainline-rollout-evidence";

const OWNER_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";
const SHIPPO_ORIGIN = "https://api.goshippo.com";
const SHIPPO_PAGE_SIZE = 100;
const MAX_SHIPPO_PAGES = 100;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/;
const CLAIM_PATTERN = /^order-label-claim:[0-9a-f-]{36}$/;
const HTTPS_URL_PATTERN = /^https:\/\/[^\s]+$/;

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function positiveInteger(env, key) {
  const value = required(env, key);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${key} must be a positive safe integer`);
  }
  return Number(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function reviewedShippoMode(apiKey) {
  if (apiKey.startsWith("shippo_test_")) return true;
  if (apiKey.startsWith("shippo_live_")) return false;
  throw new Error("SHIPPO_API_KEY does not identify a reviewed test or live credential");
}

function reviewedStripeMode(apiKey) {
  if (apiKey.startsWith("sk_test_")) return "test";
  if (apiKey.startsWith("sk_live_")) return "live";
  throw new Error("STRIPE_SECRET_KEY does not identify a reviewed Stripe credential");
}

export function parseOrderLabelAmbiguousReconciliationConfig(
  env = process.env,
  {
    evidenceDirectory = ORDER_LABEL_AMBIGUOUS_EVIDENCE_DIRECTORY,
    evidenceExists = existsSync,
  } = {},
) {
  assertDeterministicPostgresEnvironment(env, "Order label ambiguous reconciliation");
  if (
    env.ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CONFIRM
      !== ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CONFIRMATION
  ) {
    throw new Error("Order label ambiguous reconciliation confirmation is invalid");
  }
  const expectedCommit = required(
    env,
    "ORDER_LABEL_AMBIGUOUS_RECONCILIATION_EXPECTED_COMMIT",
  );
  if (!COMMIT_PATTERN.test(expectedCommit)) {
    throw new Error("Order label ambiguous reconciliation commit is invalid");
  }
  const orderId = required(env, "ORDER_LABEL_AMBIGUOUS_RECONCILIATION_ORDER_ID");
  const claimId = required(env, "ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CLAIM_ID");
  const staffUserId = required(
    env,
    "ORDER_LABEL_AMBIGUOUS_RECONCILIATION_STAFF_USER_ID",
  );
  const claimGeneration = positiveInteger(
    env,
    "ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CLAIM_GENERATION",
  );
  if (!ID_PATTERN.test(orderId) || !ID_PATTERN.test(staffUserId) || !CLAIM_PATTERN.test(claimId)) {
    throw new Error("Order label ambiguous reconciliation identity is invalid");
  }
  const requestedTransactionId =
    env.ORDER_LABEL_AMBIGUOUS_RECONCILIATION_TRANSACTION_ID == null
      ? null
      : required(env, "ORDER_LABEL_AMBIGUOUS_RECONCILIATION_TRANSACTION_ID");
  if (requestedTransactionId !== null && !ID_PATTERN.test(requestedTransactionId)) {
    throw new Error("Order label ambiguous reconciliation transaction identity is invalid");
  }

  const directUrl = required(env, "DIRECT_URL");
  const databaseUrl = required(env, "DATABASE_URL");
  const directUrlSha256 = sha256(directUrl);
  if (
    !SHA256_PATTERN.test(required(env, "PRODUCTION_MIGRATION_DIRECT_URL_SHA256"))
    || directUrlSha256 !== env.PRODUCTION_MIGRATION_DIRECT_URL_SHA256
  ) {
    throw new Error("DIRECT_URL does not match the protected Production digest");
  }
  const ownerIdentity = parseVercelRuntimeDatabaseIdentity(directUrl, "DIRECT_URL");
  const runtimeIdentity = parseVercelRuntimeDatabaseIdentity(databaseUrl, "DATABASE_URL");
  const reviewed = REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
  if (
    ownerIdentity.isPooler
    || ownerIdentity.username !== OWNER_ROLE
    || runtimeIdentity.isPooler !== true
    || runtimeIdentity.username !== RUNTIME_ROLE
    || ownerIdentity.endpointId !== reviewed.endpointId
    || runtimeIdentity.endpointId !== reviewed.endpointId
    || ownerIdentity.region !== reviewed.region
    || runtimeIdentity.region !== reviewed.region
    || ownerIdentity.databaseName !== reviewed.databaseName
    || runtimeIdentity.databaseName !== reviewed.databaseName
    || env.MIGRATION_DB_ROLE !== OWNER_ROLE
    || env.RUNTIME_DB_ROLE !== RUNTIME_ROLE
  ) {
    throw new Error("Order label reconciliation database roles or production target drifted");
  }

  const shippoApiKey = required(env, "SHIPPO_API_KEY");
  const stripeSecretKey = required(env, "STRIPE_SECRET_KEY");
  const shippoTestMode = reviewedShippoMode(shippoApiKey);
  const stripeMode = reviewedStripeMode(stripeSecretKey);
  if ((shippoTestMode && stripeMode !== "test") || (!shippoTestMode && stripeMode !== "live")) {
    throw new Error("Shippo and Stripe credential modes do not match");
  }

  const evidencePath = path.resolve(
    required(env, "ORDER_LABEL_AMBIGUOUS_RECONCILIATION_EVIDENCE_PATH"),
  );
  const expectedEvidencePath = path.join(
    path.resolve(evidenceDirectory),
    `order-label-ambiguous-reconciliation-${expectedCommit}-${claimGeneration}.json`,
  );
  if (
    evidencePath !== expectedEvidencePath
    || evidenceExists(evidencePath)
    || evidenceExists(`${evidencePath}.next`)
  ) {
    throw new Error("Order label ambiguous reconciliation evidence path is not fresh and exact");
  }

  return Object.freeze({
    claimGeneration,
    claimId,
    databaseUrl,
    directUrl,
    directUrlSha256,
    evidencePath,
    expectedCommit,
    orderId,
    requestedTransactionId,
    shippoApiKey,
    shippoTestMode,
    staffUserId,
    stripeSecretKey,
  });
}

export function readOrderLabelAmbiguousReconciliationGitState(cwd = process.cwd()) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertOrderLabelAmbiguousReconciliationGitState(state, expectedCommit) {
  if (state?.head !== expectedCommit || state.status !== "") {
    throw new Error("Order label reconciliation checkout is not the exact clean reviewed commit");
  }
  return Object.freeze({ clean: true, head: state.head });
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  return value;
}

function boundedId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactMoney(value, label) {
  if (
    !((typeof value === "string" && /^\d+(?:\.\d{1,4})?$/.test(value))
      || (typeof value === "number" && Number.isFinite(value)))
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  const numeric = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 500_000) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(numeric);
}

function rateIdFromTransaction(transaction) {
  const rate = transaction?.rate;
  if (typeof rate === "string") {
    const normalized = rate.replace(/\/+$/, "");
    return normalized.slice(normalized.lastIndexOf("/") + 1);
  }
  return rate?.object_id ?? null;
}

function carrierFromRate(rate) {
  const value = rate?.provider;
  if (typeof value !== "string" || value.trim().length < 1 || value.length > 100) {
    throw new TypeError("Shippo transaction carrier is invalid");
  }
  return value.trim();
}

function claimMetadata(transaction) {
  return typeof transaction?.metadata === "string" ? transaction.metadata : null;
}

export function validateOrderLabelProviderTransaction(
  transactionValue,
  rateValue,
  claim,
  shippoTestMode,
) {
  const transaction = object(transactionValue, "Shippo transaction");
  const transactionId = boundedId(transaction.object_id, "Shippo transaction id");
  if (claimMetadata(transaction) !== claim.claimId) {
    throw new Error("Shippo transaction metadata does not match the exact claim");
  }
  if (transaction.test !== shippoTestMode) {
    throw new Error("Shippo transaction mode does not match the reviewed credential");
  }
  if (rateIdFromTransaction(transaction) !== claim.rateObjectId) {
    throw new Error("Shippo transaction rate does not match the exact claim");
  }
  if (transaction.status === "ERROR") {
    return Object.freeze({
      kind: "provider_error",
      transactionId,
    });
  }
  if (transaction.status !== "SUCCESS") {
    throw new Error("Shippo transaction is not in a terminal SUCCESS or ERROR state");
  }
  const rate = object(rateValue, "Shippo rate");
  if (rate.object_id !== claim.rateObjectId) {
    throw new Error("Shippo rate evidence does not match the exact claim");
  }
  const amountCents = exactMoney(rate.amount, "Shippo rate amount");
  const currency = typeof rate.currency === "string" ? rate.currency.toLowerCase() : null;
  const labelUrl = typeof transaction.label_url === "string"
    ? transaction.label_url.trim()
    : "";
  if (
    amountCents !== claim.amountCents
    || currency !== claim.currency
    || !HTTPS_URL_PATTERN.test(labelUrl)
    || labelUrl.length > 2048
  ) {
    throw new Error("Shippo success evidence does not match the exact claim");
  }
  const trackingNumber = transaction.tracking_number == null
    ? null
    : String(transaction.tracking_number).trim() || null;
  if (trackingNumber !== null && trackingNumber.length > 100) {
    throw new Error("Shippo tracking number exceeded its bound");
  }
  return Object.freeze({
    amountCents,
    carrier: carrierFromRate(rate),
    currency,
    kind: "provider_success",
    labelUrl,
    rateObjectId: claim.rateObjectId,
    trackingNumber,
    transactionId,
  });
}

function exactShippoNextPage(value, currentPage, rateObjectId) {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("Shippo transaction page next link is invalid");
  const next = new URL(value);
  if (
    next.origin !== SHIPPO_ORIGIN
    || next.pathname.replace(/\/+$/, "") !== "/transactions"
    || next.searchParams.get("rate") !== rateObjectId
    || next.searchParams.get("results") !== String(SHIPPO_PAGE_SIZE)
    || next.searchParams.get("page") !== String(currentPage + 1)
    || [...next.searchParams.keys()].some((key) => !["rate", "results", "page"].includes(key))
  ) {
    throw new Error("Shippo transaction pagination escaped the exact reviewed scope");
  }
  return next.toString();
}

async function readShippoJson(url, config, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `ShippoToken ${config.shippoApiKey}` },
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`Shippo reconciliation request failed with HTTP ${response.status}`);
  }
  const length = response.headers?.get?.("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    throw new Error("Shippo reconciliation response exceeded its size bound");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("Shippo reconciliation response exceeded its size bound");
  }
  return JSON.parse(text);
}

async function loadRateEvidence(transaction, claim, config, fetchImpl) {
  if (
    transaction?.rate
    && typeof transaction.rate === "object"
    && transaction.rate.object_id === claim.rateObjectId
    && transaction.rate.amount != null
    && transaction.rate.currency
    && transaction.rate.provider
  ) {
    return transaction.rate;
  }
  return readShippoJson(
    `${SHIPPO_ORIGIN}/rates/${encodeURIComponent(claim.rateObjectId)}/`,
    config,
    fetchImpl,
  );
}

function transactionScanFact(transaction, expectedRateObjectId, expectedTestMode) {
  const transactionId = boundedId(
    transaction?.object_id,
    "Shippo scanned transaction id",
  );
  const metadata = claimMetadata(transaction);
  if (metadata !== null && (metadata.length < 1 || metadata.length > 100)) {
    throw new Error("Shippo scanned transaction metadata is invalid");
  }
  if (
    rateIdFromTransaction(transaction) !== expectedRateObjectId
    || transaction?.test !== expectedTestMode
    || typeof transaction?.status !== "string"
    || transaction.status.length < 1
    || transaction.status.length > 32
  ) {
    throw new Error("Shippo scanned transaction escaped the exact rate or mode scope");
  }
  return Object.freeze({
    idSha256: sha256(transactionId),
    metadataSha256: sha256(metadata ?? ""),
    rateSha256: sha256(expectedRateObjectId),
    status: transaction.status,
    test: transaction.test,
  });
}

export async function scanOrderLabelProviderTransactions(
  claim,
  config,
  fetchImpl = fetch,
) {
  const transactions = [];
  const scanFacts = [];
  let expectedCount = null;
  let page = 1;
  let url = `${SHIPPO_ORIGIN}/transactions/?rate=${encodeURIComponent(claim.rateObjectId)}`
    + `&results=${SHIPPO_PAGE_SIZE}&page=${page}`;
  while (url) {
    if (page > MAX_SHIPPO_PAGES) {
      throw new Error("Shippo transaction scan exceeded its reviewed page bound");
    }
    const payload = object(await readShippoJson(url, config, fetchImpl), "Shippo transaction page");
    if (!Array.isArray(payload.results) || !Number.isSafeInteger(payload.count) || payload.count < 0) {
      throw new Error("Shippo transaction page shape is invalid");
    }
    if (payload.count > SHIPPO_PAGE_SIZE * MAX_SHIPPO_PAGES) {
      throw new Error("Shippo transaction scan count exceeded its reviewed bound");
    }
    if (expectedCount === null) expectedCount = payload.count;
    if (payload.count !== expectedCount) {
      throw new Error("Shippo transaction scan count changed between pages");
    }
    scanFacts.push(...payload.results.map((transaction) =>
      transactionScanFact(transaction, claim.rateObjectId, config.shippoTestMode),
    ));
    transactions.push(...payload.results);
    url = exactShippoNextPage(payload.next, page, claim.rateObjectId);
    if ((transactions.length < expectedCount) !== Boolean(url)) {
      throw new Error("Shippo transaction pagination is incomplete or overlong");
    }
    page += 1;
  }
  if (transactions.length !== expectedCount) {
    throw new Error("Shippo transaction scan did not account for the exact result count");
  }
  const transactionIdentities = scanFacts.map((fact) => fact.idSha256);
  if (new Set(transactionIdentities).size !== transactionIdentities.length) {
    throw new Error("Shippo transaction scan repeated a transaction identity");
  }

  const matches = transactions.filter((transaction) =>
    claimMetadata(transaction) === claim.claimId,
  );
  const providerScanSha256 = sha256(JSON.stringify({
    claimGeneration: claim.claimGeneration,
    rateObjectIdSha256: sha256(claim.rateObjectId),
    requestedTransactionIdSha256: config.requestedTransactionId
      ? sha256(config.requestedTransactionId)
      : null,
    scanFacts,
  }));
  if (matches.length > 1) {
    throw new Error("Shippo reconciliation found multiple transactions for one exact claim");
  }
  if (matches.length === 0) {
    return Object.freeze({ kind: "no_transaction", providerScanSha256 });
  }
  const transaction = matches[0];
  if (
    config.requestedTransactionId
    && transaction.object_id !== config.requestedTransactionId
  ) {
    throw new Error("Requested Shippo transaction is not the unique exact-claim match");
  }
  const rate = transaction.status === "SUCCESS"
    ? await loadRateEvidence(transaction, claim, config, fetchImpl)
    : null;
  return Object.freeze({
    ...validateOrderLabelProviderTransaction(
      transaction,
      rate,
      claim,
      config.shippoTestMode,
    ),
    providerScanSha256,
  });
}

function exactDatabaseResult(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`${label} returned invalid cardinality`);
  }
  return rows[0].result;
}

export async function readOrderLabelAmbiguousClaim(ownerClient, config) {
  const result = await ownerClient.query(
    `SELECT public.grainline_order_label_ambiguous_claim_read($1::text, $2::text, $3::text, $4::bigint) AS result`,
    [config.staffUserId, config.orderId, config.claimId, config.claimGeneration],
  );
  const value = exactDatabaseResult(result.rows, "Order label ambiguous claim read");
  if (!value) {
    throw new Error("Exact ambiguous Order label claim is not available to the reviewed staff actor");
  }
  if (value.outcome === "released") {
    if (
      value.orderId !== config.orderId
      || value.claimId !== config.claimId
      || Number(value.claimGeneration) !== config.claimGeneration
      || value.resolution !== "PROVIDER_ERROR"
      || typeof value.providerScanSha256 !== "string"
      || !SHA256_PATTERN.test(value.providerScanSha256)
      || !ID_PATTERN.test(value.auditLogId)
    ) {
      throw new Error("Released Order label reconciliation evidence is invalid");
    }
    return Object.freeze({
      auditLogId: value.auditLogId,
      claimGeneration: config.claimGeneration,
      claimId: config.claimId,
      orderId: config.orderId,
      outcome: "released",
      providerScanSha256: value.providerScanSha256,
      resolution: value.resolution,
    });
  }
  if (value.outcome === "conflict") {
    throw new Error(`Exact Order label claim changed state: ${value.reason ?? "unknown"}`);
  }
  if (!new Set(["ready", "recorded"]).has(value.outcome)) {
    throw new Error("Exact ambiguous Order label claim state is unrecognized");
  }
  const claim = Object.freeze({
    amountCents: Number(value.amountCents),
    claimGeneration: Number(value.claimGeneration),
    claimId: value.claimId,
    claimStartedAtEpochMillis: value.outcome === "ready"
      ? Number(value.claimStartedAtEpochMillis)
      : null,
    currency: value.currency,
    orderId: value.orderId,
    rateObjectId: value.rateObjectId,
    sellerActorUserId: value.sellerActorUserId,
    ...(value.outcome === "recorded" ? {
      clawbackGeneration: Number(value.clawbackGeneration),
      clawbackStatus: value.clawbackStatus,
      outcome: "recorded",
      stripeTransferId: value.stripeTransferId,
      transactionId: value.transactionId,
    } : { outcome: "ready" }),
  });
  if (
    claim.orderId !== config.orderId
    || claim.claimId !== config.claimId
    || claim.claimGeneration !== config.claimGeneration
    || !Number.isSafeInteger(claim.amountCents)
    || claim.amountCents < 0
    || claim.amountCents > 500_000
    || !/^[a-z]{3}$/.test(claim.currency)
    || !ID_PATTERN.test(claim.rateObjectId)
    || !ID_PATTERN.test(claim.sellerActorUserId)
    || (claim.outcome === "ready" && (
      !Number.isSafeInteger(claim.claimStartedAtEpochMillis)
      || claim.claimStartedAtEpochMillis < 1
    ))
  ) {
    throw new Error("Exact ambiguous Order label claim evidence is invalid");
  }
  if (claim.outcome === "recorded" && (
    !Number.isSafeInteger(claim.clawbackGeneration)
    || claim.clawbackGeneration < 0
    || !new Set([
      "NOT_REQUIRED", "RETRYING", "RETRY_PENDING", "REVERSED", "MANUAL_REVIEW",
    ]).has(claim.clawbackStatus)
    || (claim.stripeTransferId !== null && !ID_PATTERN.test(claim.stripeTransferId))
    || !ID_PATTERN.test(claim.transactionId)
  )) {
    throw new Error("Recorded Order label reconciliation evidence is invalid");
  }
  return claim;
}

export async function releaseOrderLabelAmbiguousClaim(
  ownerClient,
  config,
  resolution,
  providerScanSha256,
) {
  if (resolution !== "PROVIDER_ERROR") {
    throw new Error("Only an exact Shippo ERROR transaction may release an ambiguous claim");
  }
  const result = await ownerClient.query(
    `SELECT public.grainline_order_label_ambiguous_release($1::text, $2::text, $3::text, $4::bigint, $5::text, $6::text) AS result`,
    [
      config.staffUserId,
      config.orderId,
      config.claimId,
      config.claimGeneration,
      resolution,
      providerScanSha256,
    ],
  );
  const value = exactDatabaseResult(result.rows, "Order label ambiguous release");
  if (!value || value.outcome !== "released" || value.orderId !== config.orderId) {
    throw new Error(`Order label ambiguous release was not accepted: ${value?.reason ?? "unknown"}`);
  }
  return value;
}

export async function loadOrderLabelApplicationDependencies(root = process.cwd()) {
  const jiti = createJiti(import.meta.url, {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  const [{ finalizeSellerLabelProviderResult }, authority, clawback] = await Promise.all([
    jiti.import(path.join(root, "src/lib/orderLabelFinalization.ts")),
    jiti.import(path.join(root, "src/lib/orderLabelAuthority.ts")),
    jiti.import(path.join(root, "src/lib/labelClawbackState.ts")),
  ]);
  return Object.freeze({
    finalizeLabelClawback: authority.finalizeLabelClawback,
    finalizeSellerLabelProviderResult,
    labelClawbackErrorMessage: clawback.labelClawbackErrorMessage,
    labelClawbackIdempotencyKey: clawback.labelClawbackIdempotencyKey,
  });
}

function evidenceFor(config, claim, scan, outcome) {
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    status: outcome.status,
    productionChanged: outcome.productionChanged,
    exactCommit: config.expectedCommit,
    target: Object.freeze({
      databaseName: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.databaseName,
      endpointId: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.endpointId,
      ownerRole: OWNER_ROLE,
      runtimeRole: RUNTIME_ROLE,
    }),
    claim: Object.freeze({
      amountCents: claim.amountCents ?? null,
      claimGeneration: claim.claimGeneration,
      claimIdSha256: sha256(claim.claimId),
      orderIdSha256: sha256(claim.orderId),
      rateObjectIdSha256: claim.rateObjectId ? sha256(claim.rateObjectId) : null,
      sellerActorUserIdSha256: claim.sellerActorUserId
        ? sha256(claim.sellerActorUserId)
        : null,
    }),
    provider: Object.freeze({
      scanSha256: scan.providerScanSha256,
      transactionIdSha256: scan.transactionId ? sha256(scan.transactionId) : null,
      outcome: scan.kind,
      testMode: config.shippoTestMode,
    }),
    result: Object.freeze({
      clawbackStatus: outcome.clawbackStatus ?? null,
      databaseOutcome: outcome.databaseOutcome,
    }),
  });
}

export function writeOrderLabelAmbiguousEvidence(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (
    /postgres(?:ql)?:\/\//i.test(serialized)
    || /(?:shippo|sk)_(?:test|live)_/i.test(serialized)
    || /order-label-claim:[0-9a-f-]{36}/i.test(serialized)
  ) {
    throw new Error("Order label reconciliation evidence contains sensitive raw identity");
  }
  const nextPath = `${filePath}.next`;
  if (existsSync(filePath) || existsSync(nextPath)) {
    throw new Error("Order label reconciliation evidence path is not fresh");
  }
  const fd = openSync(nextPath, "wx", 0o600);
  try {
    writeFileSync(fd, serialized, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(nextPath, 0o600);
  renameSync(nextPath, filePath);
  chmodSync(filePath, 0o600);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("Order label reconciliation evidence is not a private regular file");
  }
  return value;
}

export function sanitizeOrderLabelReconciliationError(error) {
  return String(error instanceof Error ? error.message || error.name : error)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-database-url]")
    .replace(/\b(?:shippo|sk)_(?:test|live)_[A-Za-z0-9_]+\b/g, "[redacted-provider-secret]")
    .replace(/order-label-claim:[0-9a-f-]{36}/gi, "[redacted-claim-id]")
    .slice(0, 1000);
}

export async function runOrderLabelAmbiguousReconciliation(
  config,
  {
    appDependencies,
    fetchImpl = fetch,
    ownerClient,
    stripeClient,
  },
) {
  const state = await readOrderLabelAmbiguousClaim(ownerClient, config);
  if (state.outcome === "released") {
    const claim = {
      amountCents: null,
      claimGeneration: state.claimGeneration,
      claimId: state.claimId,
      orderId: state.orderId,
      rateObjectId: null,
      sellerActorUserId: null,
    };
    const scan = {
      kind: "provider_error",
      providerScanSha256: state.providerScanSha256,
    };
    const outcome = {
      databaseOutcome: "released",
      productionChanged: false,
      status: "already-released",
    };
    return Object.freeze({
      claim,
      evidence: evidenceFor(config, claim, scan, outcome),
      outcome,
      scan,
    });
  }
  const claim = state;
  const scanConfig = state.outcome === "recorded"
    ? {
        ...config,
        requestedTransactionId: (() => {
          if (
            config.requestedTransactionId
            && config.requestedTransactionId !== state.transactionId
          ) {
            throw new Error("Requested Shippo transaction conflicts with recorded claim state");
          }
          return state.transactionId;
        })(),
      }
    : config;
  const scan = await scanOrderLabelProviderTransactions(claim, scanConfig, fetchImpl);
  if (state.outcome === "recorded" && scan.kind !== "provider_success") {
    throw new Error("Recorded Order label claim no longer has exact provider SUCCESS evidence");
  }
  let outcome;
  if (scan.kind === "no_transaction") {
    outcome = {
      databaseOutcome: "not_released",
      productionChanged: false,
      status: "provider-escalation-required",
    };
  } else if (scan.kind === "provider_error") {
    const released = await releaseOrderLabelAmbiguousClaim(
      ownerClient,
      config,
      "PROVIDER_ERROR",
      scan.providerScanSha256,
    );
    outcome = { databaseOutcome: released.outcome, productionChanged: true, status: "released-provider-error" };
  } else {
    const recorded = await appDependencies.finalizeSellerLabelProviderResult({
      actorUserId: claim.sellerActorUserId,
      amountCents: scan.amountCents,
      carrier: scan.carrier,
      claimGeneration: claim.claimGeneration,
      claimId: claim.claimId,
      currency: scan.currency,
      labelUrl: scan.labelUrl,
      orderId: claim.orderId,
      outcome: "SUCCESS",
      rateObjectId: scan.rateObjectId,
      trackingNumber: scan.trackingNumber,
      transactionId: scan.transactionId,
    });
    if (recorded.outcome !== "recorded") {
      throw new Error("Exact Shippo success was not recorded against the ambiguous claim");
    }
    let clawbackStatus = recorded.clawbackStatus;
    if (recorded.clawbackStatus === "RETRYING" && recorded.stripeTransferId) {
      try {
        const reversal = await stripeClient.transfers.createReversal(
          recorded.stripeTransferId,
          {
            amount: recorded.amountCents,
            metadata: { orderId: recorded.orderId, reason: "label_cost_deduction" },
          },
          {
            idempotencyKey: appDependencies.labelClawbackIdempotencyKey({
              amountCents: recorded.amountCents,
              orderId: recorded.orderId,
              shippoRateObjectId: recorded.rateObjectId,
              shippoTransactionId: recorded.transactionId,
            }),
          },
        );
        const finalized = await appDependencies.finalizeLabelClawback({
          claimGeneration: recorded.claimGeneration,
          claimId: recorded.claimId,
          clawbackGeneration: recorded.clawbackGeneration,
          orderId: recorded.orderId,
          outcome: "SUCCESS",
          reversalId: reversal.id,
        });
        if (finalized.outcome !== "finalized") {
          throw new Error("Order label clawback finalizer rejected the exact reversal");
        }
        clawbackStatus = "REVERSED";
      } catch (error) {
        const failed = await appDependencies.finalizeLabelClawback({
          claimGeneration: recorded.claimGeneration,
          claimId: recorded.claimId,
          clawbackGeneration: recorded.clawbackGeneration,
          errorSummary: appDependencies.labelClawbackErrorMessage(error),
          orderId: recorded.orderId,
          outcome: "FAILED",
        });
        if (failed.outcome !== "recorded_failure") {
          throw new Error("Order label clawback failure was not durably recorded");
        }
        clawbackStatus = failed.clawbackStatus;
      }
    }
    outcome = {
      clawbackStatus,
      databaseOutcome: recorded.outcome,
      productionChanged: true,
      status: clawbackStatus === "REVERSED" || clawbackStatus === "NOT_REQUIRED"
        ? "recorded-and-finalized"
        : "recorded-with-clawback-follow-up",
    };
  }
  return Object.freeze({ claim, evidence: evidenceFor(config, claim, scan, outcome), outcome, scan });
}

async function main() {
  const config = parseOrderLabelAmbiguousReconciliationConfig();
  assertOrderLabelAmbiguousReconciliationGitState(
    readOrderLabelAmbiguousReconciliationGitState(),
    config.expectedCommit,
  );
  const ownerClient = new Client({
    connectionString: config.directUrl,
    ...postgresChannelBindingClientOptions(new URL(config.directUrl)),
  });
  const appDependencies = await loadOrderLabelApplicationDependencies();
  const stripeClient = new Stripe(config.stripeSecretKey);
  let result;
  try {
    await ownerClient.connect();
    const identity = await ownerClient.query(
      `SELECT current_user::text AS current_user, session_user::text AS session_user, current_database()::text AS database_name`,
    );
    if (
      identity.rows.length !== 1
      || identity.rows[0].current_user !== OWNER_ROLE
      || identity.rows[0].session_user !== OWNER_ROLE
      || identity.rows[0].database_name !== REVIEWED_PRODUCTION_RUNTIME_IDENTITY.databaseName
    ) {
      throw new Error("Order label reconciliation owner database identity drifted");
    }
    result = await runOrderLabelAmbiguousReconciliation(config, {
      appDependencies,
      ownerClient,
      stripeClient,
    });
    writeOrderLabelAmbiguousEvidence(config.evidencePath, result.evidence);
  } finally {
    await ownerClient.end().catch(() => {});
  }
  process.stdout.write(`${JSON.stringify({
    evidencePath: config.evidencePath,
    status: result.outcome.status,
  })}\n`);
  if (
    result.outcome.status === "recorded-with-clawback-follow-up"
    || result.outcome.status === "provider-escalation-required"
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `Order label ambiguous reconciliation failed: ${sanitizeOrderLabelReconciliationError(error)}\n`,
    );
    process.exitCode = 1;
  });
}
