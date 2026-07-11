#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION_VALUE = "local-read";
const DEFAULT_EVIDENCE_DIR = ".";
const DEFAULT_MANIFEST_NAME = "launch-evidence-manifest.json";
const EVIDENCE_MAX_ISSUES = 80;

const INVENTORY_ENV_PATTERN =
  /["']?\b(?:LAUNCH_EVIDENCE_[A-Z0-9_]+|(?:RLS_CONTEXT_GATE|STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF|STRIPE_MONEY_PROOF|BUYER_DELETION_REPLAY_PROOF|R2_UPLOAD_SMOKE|DEPLOYED_HEADERS_PROOF|SENTRY_CRON_PROOF|SHIPPING_CURRENCY_PROOF|FOUNDING_MAKER_PROOF)_EVIDENCE_PATH)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /["']?\b(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*|password|pass|pwd|PGPASSWORD)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const STRIPE_SECRET_PATTERN = /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)/g;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export const MACHINE_ARTIFACTS = [
  {
    command: "npm run audit:stripe-webhooks",
    defaultPath: "stripe-webhook-subscriptions-evidence.json",
    envPath: "STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH",
    id: "stripe-webhook-subscriptions",
    label: "Stripe webhook subscriptions",
    requiredFor: "launch",
    requiredCheckNames: ["legacy-snapshot-webhook-subscription", "connect-v2-thin-event-destination"],
    validate(payload) {
      const issues = [];
      if (payload.mode !== "live") issues.push("mode must be live");
      return issues;
    },
  },
  {
    command: "npm run audit:stripe-money",
    defaultPath: "stripe-money-proof-evidence.json",
    envPath: "STRIPE_MONEY_PROOF_EVIDENCE_PATH",
    id: "stripe-money-movement",
    label: "Stripe money movement",
    requiredFor: "launch",
    requiredScenarios: [
      "full_reverse_transfer_refund",
      "partial_reverse_transfer_refund",
      "platform_only_refund",
      "label_clawback_success",
      "label_clawback_missing_transfer",
      "label_clawback_retry_pending",
      "label_clawback_manual_review",
    ],
    validate(payload) {
      const issues = [];
      if (payload.stripe?.mode !== "test") issues.push("stripe.mode must be test");
      return issues;
    },
  },
  {
    command: "npm run audit:buyer-deletion-replay",
    defaultPath: "buyer-deletion-replay-evidence.json",
    envPath: "BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH",
    id: "buyer-deletion-replay",
    label: "Buyer-deletion Stripe replay",
    requiredFor: "launch",
    validate(payload) {
      const issues = [];
      if (payload.stripe?.mode !== "test") issues.push("stripe.mode must be test");
      if (payload.proof?.order?.buyerDetached !== true) issues.push("proof.order.buyerDetached must be true");
      if (payload.proof?.order?.buyerDataPurged !== true) issues.push("proof.order.buyerDataPurged must be true");
      if (payload.proof?.evidence?.webhookEventProcessed !== true) {
        issues.push("proof.evidence.webhookEventProcessed must be true");
      }
      if (payload.proof?.order?.refundRecorded !== true) issues.push("proof.order.refundRecorded must be true");
      return issues;
    },
  },
  {
    command: "npm run audit:r2-upload",
    defaultPath: "r2-upload-smoke-evidence.json",
    envPath: "R2_UPLOAD_SMOKE_EVIDENCE_PATH",
    id: "r2-upload-smoke",
    label: "Cloudflare R2 upload smoke",
    requiredFor: "launch",
    requiredCheckNames: [
      "head-bucket",
      "processed-image-object",
      "direct-upload-object",
      "public-bucket-listing-probe",
      "cleanup",
    ],
  },
  {
    command: "npm run audit:deployed-headers",
    defaultPath: "deployed-security-headers-evidence.json",
    envPath: "DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH",
    id: "deployed-security-headers",
    label: "Deployed security headers",
    requiredFor: "launch",
    requiredCheckNames: ["root-security-headers", "health-private-cache-headers"],
  },
  {
    command: "npm run audit:sentry-crons",
    defaultPath: "sentry-cron-alert-evidence.json",
    envPath: "SENTRY_CRON_PROOF_EVIDENCE_PATH",
    id: "sentry-cron-alerts",
    label: "Sentry cron alerts",
    requiredFor: "launch",
    requiredCheckNames: ["sentry-cron-monitors", "sentry-alert-routing"],
  },
  {
    command: "npm run audit:shipping-currency",
    defaultPath: "shipping-currency-drift-evidence.json",
    envPath: "SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH",
    id: "shipping-currency-drift",
    label: "Shipping currency drift",
    requiredFor: "launch",
    validate(payload) {
      const issues = [];
      if (payload.actionableFindingCount !== 0) issues.push("actionableFindingCount must be 0");
      return issues;
    },
  },
  {
    command: "npm run audit:rls-context",
    defaultPath: "rls-context-gate-evidence.json",
    envPath: "RLS_CONTEXT_GATE_EVIDENCE_PATH",
    id: "rls-context-gate",
    label: "RLS staging context gate",
    requiredFor: "conditional",
  },
  {
    command: "npm run audit:founding-maker",
    defaultPath: "founding-maker-concurrency-evidence.json",
    envPath: "FOUNDING_MAKER_PROOF_EVIDENCE_PATH",
    id: "founding-maker-concurrency",
    label: "Founding Maker concurrency",
    requiredFor: "conditional",
    validate(payload) {
      const issues = [];
      if (payload.actionableFindingCount !== 0) issues.push("actionableFindingCount must be 0");
      return issues;
    },
  },
];

export const MANUAL_EVIDENCE_ITEMS = [
  { id: "securityheaders-scan", label: "securityheaders.com result", requiredFor: "launch" },
  { id: "ssl-labs-scan", label: "SSL Labs result", requiredFor: "launch" },
  { id: "hsts-preload-status", label: "HSTS preload status or decision", requiredFor: "launch" },
  { id: "clerk-security-controls", label: "Clerk security controls", requiredFor: "launch" },
  { id: "owner-admin-hardware-mfa", label: "Provider owner/admin hardware MFA", requiredFor: "launch" },
  { id: "stripe-signing-secret-matching", label: "Stripe/Vercel signing-secret matching", requiredFor: "launch" },
  { id: "stripe-pci-saq-a", label: "Stripe PCI SAQ A", requiredFor: "launch" },
  { id: "cloudflare-r2-dashboard-posture", label: "Cloudflare R2 dashboard/CLI posture", requiredFor: "launch" },
  { id: "cloudflare-tls-waf-settings", label: "Cloudflare TLS/WAF settings", requiredFor: "launch" },
  { id: "sentry-notification-delivery", label: "Sentry alert notification delivery", requiredFor: "launch" },
  { id: "github-code-security-settings", label: "GitHub code security settings", requiredFor: "launch" },
  { id: "google-search-console", label: "Google Search Console verification and sitemap", requiredFor: "launch" },
  { id: "neon-backup-restore-drill", label: "Neon backup/PITR and restore drill", requiredFor: "launch" },
  { id: "attorney-terms-privacy", label: "Attorney Terms/Privacy sign-off", requiredFor: "launch" },
  { id: "money-transmitter-analysis", label: "Money transmitter analysis", requiredFor: "launch" },
  { id: "business-insurance-decision", label: "Business insurance decision", requiredFor: "launch" },
  { id: "inform-consumers-act-scope", label: "INFORM Consumers Act scope", requiredFor: "launch" },
  { id: "dmca-agent-details", label: "DMCA agent details", requiredFor: "launch" },
  { id: "rls-policy-rollout-decision", label: "RLS policy rollout decision/evidence", requiredFor: "conditional" },
  { id: "founding-maker-launch-scale-decision", label: "Founding Maker launch-scale decision", requiredFor: "conditional" },
];

export function redact(value) {
  return String(value ?? "")
    .replace(INVENTORY_ENV_PATTERN, "[redacted-launch-evidence-env]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "[redacted-secret-assignment]")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(URL_USERINFO_PATTERN, "$1[redacted-credentials]@")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]");
}

function safeError(error) {
  if (error instanceof Error) return redact(error.message || error.name);
  return redact(String(error));
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseBooleanFlag(env, name) {
  return env[name] === "1" || env[name] === "true";
}

function resolveInsideRepo(raw, label) {
  if (!raw) throw new Error(`${label} is required`);
  if (raw.includes("\0")) throw new Error(`${label} must not contain null bytes`);
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return resolved;
}

export function parseConfig(env = process.env) {
  if (env.LAUNCH_EVIDENCE_INVENTORY_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`LAUNCH_EVIDENCE_INVENTORY_CONFIRM=${CONFIRMATION_VALUE} is required`);
  }
  const evidenceDir = resolveInsideRepo(env.LAUNCH_EVIDENCE_DIR || DEFAULT_EVIDENCE_DIR, "LAUNCH_EVIDENCE_DIR");
  const inventoryPath = resolveInsideRepo(
    required(env, "LAUNCH_EVIDENCE_INVENTORY_PATH"),
    "LAUNCH_EVIDENCE_INVENTORY_PATH",
  );
  const manifestPath = resolveInsideRepo(
    env.LAUNCH_EVIDENCE_MANIFEST_PATH || path.join(path.relative(ROOT_DIR, evidenceDir), DEFAULT_MANIFEST_NAME),
    "LAUNCH_EVIDENCE_MANIFEST_PATH",
  );
  return {
    evidenceDir,
    inventoryPath,
    manifestPath,
    requireConditional: parseBooleanFlag(env, "LAUNCH_EVIDENCE_REQUIRE_CONDITIONAL"),
  };
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function relativePath(value) {
  return value ? path.relative(ROOT_DIR, value) || "." : null;
}

function artifactPath(definition, config, env = process.env) {
  const override = env[definition.envPath];
  return override
    ? resolveInsideRepo(override, definition.envPath)
    : path.join(config.evidenceDir, definition.defaultPath);
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizeIssues(values) {
  return values.map(redact).filter(Boolean);
}

function commonPayloadIssues(payload) {
  const issues = [];
  if (payload?.status !== "passed") issues.push(`status must be passed, got ${payload?.status ?? "missing"}`);
  if (!payload?.generatedAt && !payload?.completedAt) issues.push("generatedAt/completedAt timestamp missing");
  if (!payload?.commitSha) issues.push("commitSha missing");
  if (Array.isArray(payload?.issues) && payload.issues.length > 0) {
    issues.push("artifact contains retained issues");
  }
  return issues;
}

function checkNames(payload) {
  return new Set((payload?.checks ?? []).map((check) => check?.name).filter(Boolean));
}

function scenarioNames(payload) {
  return new Set((payload?.scenarios ?? []).map((scenario) => scenario?.scenario).filter(Boolean));
}

export function evaluateMachineArtifact(definition, payload) {
  const issues = commonPayloadIssues(payload);
  if (definition.requiredCheckNames) {
    const actual = checkNames(payload);
    for (const name of definition.requiredCheckNames) {
      if (!actual.has(name)) issues.push(`missing check ${name}`);
    }
  }
  if (definition.requiredScenarios) {
    const actual = scenarioNames(payload);
    for (const name of definition.requiredScenarios) {
      if (!actual.has(name)) issues.push(`missing scenario ${name}`);
    }
  }
  if (definition.validate) issues.push(...definition.validate(payload));
  return normalizeIssues(issues);
}

function manualManifestRows(manifest) {
  if (!manifest) return {};
  if (manifest.manualEvidence && typeof manifest.manualEvidence === "object") {
    return manifest.manualEvidence;
  }
  return typeof manifest === "object" ? manifest : {};
}

export function evaluateManualEvidence(item, row) {
  const issues = [];
  if (!row) return ["manual evidence missing"];
  const status = String(row.status ?? "").toLowerCase();
  if (!["retained", "accepted", "not_applicable"].includes(status)) {
    issues.push("status must be retained, accepted, or not_applicable");
  }
  if (status === "not_applicable") {
    if (!String(row.reason ?? "").trim()) issues.push("not_applicable evidence needs a reason");
  } else {
    if (!String(row.reference ?? "").trim()) issues.push("reference is required");
    if (!String(row.capturedAt ?? row.date ?? "").trim()) issues.push("capturedAt or date is required");
  }
  return normalizeIssues(issues);
}

function loadManualManifest(config) {
  if (!existsSync(config.manifestPath)) {
    return { exists: false, manifest: null, parseIssue: null };
  }
  try {
    return { exists: true, manifest: readJsonFile(config.manifestPath), parseIssue: null };
  } catch (error) {
    return { exists: true, manifest: null, parseIssue: safeError(error) };
  }
}

export function buildInventory({ config, env = process.env }) {
  const machineEvidence = MACHINE_ARTIFACTS.map((definition) => {
    const filePath = artifactPath(definition, config, env);
    if (!existsSync(filePath)) {
      return {
        command: definition.command,
        id: definition.id,
        label: definition.label,
        path: relativePath(filePath),
        requiredFor: definition.requiredFor,
        status: "missing",
        issues: ["artifact missing"],
      };
    }
    try {
      const payload = readJsonFile(filePath);
      const issues = evaluateMachineArtifact(definition, payload);
      return {
        command: definition.command,
        generatedAt: payload.generatedAt ?? payload.completedAt ?? null,
        id: definition.id,
        label: definition.label,
        path: relativePath(filePath),
        requiredFor: definition.requiredFor,
        status: issues.length === 0 ? "passed" : "failed",
        issues,
      };
    } catch (error) {
      return {
        command: definition.command,
        id: definition.id,
        label: definition.label,
        path: relativePath(filePath),
        requiredFor: definition.requiredFor,
        status: "failed",
        issues: [safeError(error)],
      };
    }
  });

  const manifestState = loadManualManifest(config);
  const rows = manualManifestRows(manifestState.manifest);
  const manualEvidence = MANUAL_EVIDENCE_ITEMS.map((item) => {
    const row = rows[item.id];
    const issues = manifestState.parseIssue
      ? [`manifest parse failed: ${manifestState.parseIssue}`]
      : evaluateManualEvidence(item, row);
    return {
      capturedAt: row?.capturedAt ?? row?.date ?? null,
      id: item.id,
      label: item.label,
      reference: row?.reference ? redact(row.reference) : null,
      reason: row?.reason ? redact(row.reason) : null,
      requiredFor: item.requiredFor,
      status: issues.length === 0 ? String(row.status).toLowerCase() : "missing",
      issues,
    };
  });

  const requiredMachine = machineEvidence.filter((row) => row.requiredFor === "launch");
  const requiredManual = manualEvidence.filter((row) => row.requiredFor === "launch");
  const conditionalMachine = machineEvidence.filter((row) => row.requiredFor === "conditional");
  const conditionalManual = manualEvidence.filter((row) => row.requiredFor === "conditional");
  const failedRequired = [...requiredMachine, ...requiredManual].filter((row) => row.issues.length > 0);
  const failedConditional = [...conditionalMachine, ...conditionalManual].filter((row) => row.issues.length > 0);
  const blockingRows = config.requireConditional ? [...failedRequired, ...failedConditional] : failedRequired;

  return {
    generatedAt: new Date().toISOString(),
    commitSha: env.LAUNCH_EVIDENCE_INVENTORY_COMMIT_SHA || env.GITHUB_SHA || gitHead(),
    status: blockingRows.length === 0 ? "passed" : "failed",
    config: {
      evidenceDir: relativePath(config.evidenceDir),
      inventoryPath: relativePath(config.inventoryPath),
      manifestPath: relativePath(config.manifestPath),
      manifestFound: manifestState.exists,
      requireConditional: config.requireConditional,
    },
    summary: {
      requiredMachine: {
        total: requiredMachine.length,
        passed: requiredMachine.filter((row) => row.issues.length === 0).length,
        missingOrFailed: failedRequired.filter((row) => machineEvidence.includes(row)).length,
      },
      requiredManual: {
        total: requiredManual.length,
        passed: requiredManual.filter((row) => row.issues.length === 0).length,
        missingOrFailed: failedRequired.filter((row) => manualEvidence.includes(row)).length,
      },
      conditional: {
        total: conditionalMachine.length + conditionalManual.length,
        passed: [...conditionalMachine, ...conditionalManual].filter((row) => row.issues.length === 0).length,
        missingOrFailed: failedConditional.length,
      },
      blockingCount: blockingRows.length,
    },
    machineEvidence,
    manualEvidence,
    blockingItems: blockingRows.map((row) => ({
      id: row.id,
      label: row.label,
      requiredFor: row.requiredFor,
      status: row.status,
      issues: row.issues,
    })),
    issues: blockingRows
      .map((row) => `${row.id}: ${row.issues.join("; ")}`)
      .slice(0, EVIDENCE_MAX_ISSUES)
      .map(redact),
  };
}

function writeInventory(config, payload) {
  mkdirSync(path.dirname(config.inventoryPath), { recursive: true });
  writeFileSync(config.inventoryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runLaunchEvidenceInventory(env = process.env) {
  const config = parseConfig(env);
  const inventory = buildInventory({ config, env });
  writeInventory(config, inventory);
  if (inventory.status !== "passed") {
    throw new Error(`Launch evidence inventory failed with ${inventory.summary.blockingCount} blocking missing/failed items`);
  }
  return inventory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLaunchEvidenceInventory()
    .then((inventory) => {
      console.log(`Launch evidence inventory passed with ${inventory.summary.blockingCount} blocking items`);
      console.log(`Launch evidence inventory written to ${process.env.LAUNCH_EVIDENCE_INVENTORY_PATH}`);
    })
    .catch((error) => {
      console.error(safeError(error));
      process.exitCode = 1;
    });
}
