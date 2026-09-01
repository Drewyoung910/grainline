#!/usr/bin/env node
// Non-charging provider proof for the exact minimized Shippo shipment used by
// the buyer shipping-quote route. This creates one Shippo test-mode Shipment
// object and rates; it never creates a Transaction or purchases a label.
import { execFileSync } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildShippoCheckoutQuoteShipment } from "../src/lib/shippingQuoteProvider.ts";
import {
  filterShippoRatesForCheckout,
  normalizeShippoRatesForCheckout,
} from "../src/lib/shippingQuoteState.ts";
import { shippoCredentialTestMode, shippoRequest } from "../src/lib/shippo.ts";

export const SHIPPO_QUOTE_SMOKE_CONFIRMATION = "reviewed-test-mode-quote-only";
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/;
const EVIDENCE_ROOTS = Object.freeze([
  path.resolve("/private/tmp"),
  path.resolve("/Users/drewyoung/grainline-rollout-evidence"),
]);
const TEST_QUOTE = Object.freeze({
  from: Object.freeze({
    name: "Grainline Shippo Test",
    line1: "215 Clayton St",
    city: "San Francisco",
    state: "CA",
    postal: "94117",
    country: "US",
  }),
  to: Object.freeze({
    city: "San Francisco",
    state: "CA",
    postal: "94103",
    country: "US",
  }),
  parcel: Object.freeze({
    lengthCm: 25,
    widthCm: 20,
    heightCm: 15,
    weightGrams: 900,
  }),
});

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function pathInside(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

export function parseShippoQuoteSmokeConfig(env = process.env) {
  if (env.SHIPPO_QUOTE_SMOKE_CONFIRM !== SHIPPO_QUOTE_SMOKE_CONFIRMATION) {
    throw new Error(
      `SHIPPO_QUOTE_SMOKE_CONFIRM=${SHIPPO_QUOTE_SMOKE_CONFIRMATION} is required`,
    );
  }
  const expectedCommit = required(env, "SHIPPO_QUOTE_SMOKE_EXPECTED_COMMIT");
  if (!COMMIT_PATTERN.test(expectedCommit)) {
    throw new Error("SHIPPO_QUOTE_SMOKE_EXPECTED_COMMIT must be an exact lowercase commit SHA");
  }
  const runId = required(env, "SHIPPO_QUOTE_SMOKE_RUN_ID");
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("SHIPPO_QUOTE_SMOKE_RUN_ID must be 8-80 URL-safe characters");
  }
  const evidencePath = path.resolve(required(env, "SHIPPO_QUOTE_SMOKE_EVIDENCE_PATH"));
  if (!EVIDENCE_ROOTS.some((root) => pathInside(root, evidencePath))) {
    throw new Error("SHIPPO_QUOTE_SMOKE_EVIDENCE_PATH must stay in an approved evidence directory");
  }
  if (pathInside(ROOT_DIR, evidencePath)) {
    throw new Error("Shippo quote smoke evidence must remain outside the repository");
  }
  const apiKey = required(env, "SHIPPO_API_KEY");
  if (!shippoCredentialTestMode(apiKey)) {
    throw new Error("Shippo quote smoke refuses a live-mode credential");
  }
  return Object.freeze({ apiKey, evidencePath, expectedCommit, runId });
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  }).trim();
}

function assertExactCleanCommit(expectedCommit) {
  const head = gitHead();
  if (head !== expectedCommit) {
    throw new Error("Shippo quote smoke exact commit does not match HEAD");
  }
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  if (status !== "") {
    throw new Error("Shippo quote smoke requires a clean exact-commit worktree");
  }
}

function safeError(error, apiKey = "") {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(apiKey, "[redacted-shippo-key]")
    .replace(/shippo_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted-shippo-key]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

export function summarizeShippoCheckoutQuoteResponse(shipment) {
  if (!shipment || typeof shipment !== "object" || Array.isArray(shipment)) {
    throw new Error("Shippo quote response was not an object");
  }
  if (shipment.test !== true) {
    throw new Error("Shippo quote response was not explicitly test-mode");
  }
  if (
    typeof shipment.object_id !== "string"
    || !PROVIDER_ID_PATTERN.test(shipment.object_id)
  ) {
    throw new Error("Shippo quote response lacked a valid shipment identity");
  }
  if (!Array.isArray(shipment.rates) || shipment.rates.length === 0) {
    throw new Error("Shippo quote response returned no rates");
  }
  if (shipment.rates.some((rate) => rate?.test !== true)) {
    throw new Error("Shippo quote response contained a rate not explicitly marked test-mode");
  }

  const filtered = filterShippoRatesForCheckout({
    currency: "usd",
    preferredCarriers: [],
    rates: shipment.rates,
  });
  const rates = normalizeShippoRatesForCheckout(filtered.rates);
  if (rates.length === 0) {
    throw new Error("Shippo quote response contained no checkout-usable USD rates");
  }
  if (new Set(rates.map((rate) => rate.objectId)).size !== rates.length) {
    throw new Error("Shippo quote normalization retained duplicate provider identities");
  }
  if (rates.some((rate) => !rate.objectId.startsWith("quote-only:"))) {
    throw new Error("Shippo quote normalization did not mark every rate quote-only");
  }

  const amounts = rates.map((rate) => rate.amountCents);
  return Object.freeze({
    carrierCount: new Set(rates.map((rate) => rate.carrier.toLowerCase())).size,
    currency: "usd",
    maximumAmountCents: Math.max(...amounts),
    minimumAmountCents: Math.min(...amounts),
    providerRateCount: shipment.rates.length,
    shipmentCreated: true,
    testMode: true,
    usableRateCount: rates.length,
  });
}

function writePrivateEvidence(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const descriptor = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export async function runShippoQuoteTestModeSmoke(env = process.env) {
  const startedAt = new Date().toISOString();
  const config = parseShippoQuoteSmokeConfig(env);
  assertExactCleanCommit(config.expectedCommit);
  let summary = null;
  let issue = null;

  try {
    const shipment = await shippoRequest("/shipments/", {
      method: "POST",
      body: JSON.stringify(buildShippoCheckoutQuoteShipment(TEST_QUOTE)),
    });
    summary = summarizeShippoCheckoutQuoteResponse(shipment);
  } catch (error) {
    issue = safeError(error, config.apiKey);
  }

  const completedAt = new Date().toISOString();
  const evidence = Object.freeze({
    status: issue === null ? "passed" : "failed",
    startedAt,
    completedAt,
    generatedAt: completedAt,
    exactCommit: config.expectedCommit,
    runId: config.runId,
    scope: Object.freeze({
      applicationDatabaseTouched: false,
      labelPurchased: false,
      providerMode: "test",
      providerShipmentCreated: summary?.shipmentCreated ?? null,
      transactionCreated: false,
    }),
    quote: summary,
    issues: issue === null ? [] : [issue],
  });
  const serialized = JSON.stringify(evidence);
  if (serialized.includes(config.apiKey) || /shippo_(?:test|live)_/.test(serialized)) {
    throw new Error("Shippo quote smoke evidence retained a provider credential");
  }
  writePrivateEvidence(config.evidencePath, evidence);
  if (issue !== null) {
    throw new Error(`Shippo quote smoke failed: ${issue}`);
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runShippoQuoteTestModeSmoke()
    .then((evidence) => {
      console.log(JSON.stringify({
        shippoQuoteTestModeSmoke: evidence.status,
        rateCount: evidence.quote.usableRateCount,
        labelPurchased: false,
      }));
    })
    .catch((error) => {
      console.error(safeError(error, process.env.SHIPPO_API_KEY));
      process.exitCode = 1;
    });
}
