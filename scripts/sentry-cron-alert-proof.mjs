#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION_VALUE = "live-read";
const DEFAULT_SENTRY_BASE_URL = "https://sentry.io";
const EVIDENCE_MAX_ISSUES = 20;
const MAX_SENTRY_PAGES = 25;
const DEFAULT_REQUIRED_ALERT_TERMS = [
  "cron_ops_health",
  "AccountDeletionSideEffect",
  "direct-upload",
  "webhook failure spike",
  "CSP",
];

const SENTRY_PROOF_ENV_PATTERN =
  /["']?\b(?:SENTRY_AUTH_TOKEN|SENTRY_DSN|NEXT_PUBLIC_SENTRY_DSN|SENTRY_CRON_PROOF_[A-Z0-9_]+)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const SENTRY_DSN_PATTERN = /\bhttps:\/\/[A-Za-z0-9._-]+@[^/\s]+\/[A-Za-z0-9._-]+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

function redact(value) {
  return String(value ?? "")
    .replace(SENTRY_PROOF_ENV_PATTERN, "[redacted-sentry-proof-env]")
    .replace(SENTRY_DSN_PATTERN, "https://[redacted-sentry-dsn]")
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

function evidencePathFromEnv(env) {
  const raw = required(env, "SENTRY_CRON_PROOF_EVIDENCE_PATH");
  if (raw.includes("\0")) throw new Error("SENTRY_CRON_PROOF_EVIDENCE_PATH must not contain null bytes");
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("SENTRY_CRON_PROOF_EVIDENCE_PATH must stay inside the repository");
  }
  return resolved;
}

function sentryBaseUrlFromEnv(env) {
  const raw = env.SENTRY_CRON_PROOF_BASE_URL || DEFAULT_SENTRY_BASE_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("SENTRY_CRON_PROOF_BASE_URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("SENTRY_CRON_PROOF_BASE_URL must be HTTPS");
  }
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function parseRequiredAlertTerms(raw) {
  return (raw ? raw.split(",") : DEFAULT_REQUIRED_ALERT_TERMS)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function parseConfig(env = process.env) {
  if (env.SENTRY_CRON_PROOF_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`SENTRY_CRON_PROOF_CONFIRM=${CONFIRMATION_VALUE} is required`);
  }

  return {
    authToken: required(env, "SENTRY_AUTH_TOKEN"),
    baseUrl: sentryBaseUrlFromEnv(env),
    evidencePath: evidencePathFromEnv(env),
    orgSlug: required(env, "SENTRY_ORG_SLUG"),
    projectSlug: required(env, "SENTRY_PROJECT_SLUG"),
    requiredAlertTerms: parseRequiredAlertTerms(env.SENTRY_CRON_PROOF_REQUIRED_ALERT_TERMS),
  };
}

export function cronInventoryFromVercel() {
  const vercel = JSON.parse(readFileSync(path.join(ROOT_DIR, "vercel.json"), "utf8"));
  if (!Array.isArray(vercel.crons) || vercel.crons.length === 0) {
    throw new Error("vercel.json must contain crons");
  }
  return vercel.crons.map((cron) => {
    const monitorSlug = String(cron.path ?? "").split("/").filter(Boolean).at(-1);
    if (!monitorSlug || typeof cron.schedule !== "string") {
      throw new Error(`Invalid Vercel cron entry: ${JSON.stringify(cron)}`);
    }
    return {
      path: cron.path,
      schedule: cron.schedule,
      monitorSlug,
    };
  });
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function sentryApiUrl(config, pathname, query = {}) {
  const url = new URL(pathname, config.baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const rawPart of linkHeader.split(",")) {
    const part = rawPart.trim();
    if (!/\brel="next"/.test(part) || !/\bresults="true"/.test(part)) continue;
    const match = part.match(/^<([^>]+)>/);
    if (match) return match[1];
  }
  return null;
}

async function fetchSentryJson(config, url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.authToken}`,
    },
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    throw new Error(`Sentry API ${url.pathname} returned HTTP ${response.status}: ${redact(text).slice(0, 500)}`);
  }
  return {
    json,
    nextUrl: parseNextLink(response.headers.get("link")),
  };
}

async function fetchSentryList(config, pathname, query = {}) {
  const rows = [];
  let url = sentryApiUrl(config, pathname, query);
  for (let page = 0; page < MAX_SENTRY_PAGES; page += 1) {
    const { json, nextUrl } = await fetchSentryJson(config, url);
    if (Array.isArray(json)) rows.push(...json);
    else if (Array.isArray(json?.data)) rows.push(...json.data);
    else throw new Error(`Sentry API ${url.pathname} did not return a list`);
    if (!nextUrl) return rows;
    url = new URL(nextUrl);
  }
  throw new Error(`Sentry API pagination exceeded ${MAX_SENTRY_PAGES} pages for ${pathname}`);
}

async function fetchOptionalSentryList(config, name, pathname, query = {}) {
  try {
    return {
      name,
      status: "fetched",
      rows: await fetchSentryList(config, pathname, query),
    };
  } catch (error) {
    return {
      name,
      status: "failed",
      error: safeError(error),
      rows: [],
    };
  }
}

function normalizedSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function monitorNames(monitor) {
  return [
    monitor.slug,
    monitor.name,
    monitor.id,
    monitor.monitorSlug,
    monitor.monitor_slug,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
}

function monitorStatus(monitor) {
  return String(monitor.status ?? monitor.statusValue ?? monitor.status_value ?? "").toLowerCase();
}

function isMonitorEnabled(monitor) {
  const status = monitorStatus(monitor);
  return monitor.disabled !== true && monitor.enabled !== false && status !== "disabled" && status !== "disabled:disabled";
}

function findScheduleValue(value, depth = 0) {
  if (!value || depth > 8) return null;
  if (typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findScheduleValue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const schedule = value.schedule;
  if (typeof schedule === "string") return schedule;
  if (schedule && typeof schedule === "object") {
    if (typeof schedule.value === "string") return schedule.value;
    if (typeof schedule.crontab === "string") return schedule.crontab;
  }
  if (typeof value.value === "string" && /^(?:\*|[\d,\-*/]+)\s+(?:\*|[\d,\-*/]+)\s+(?:\*|[\d,\-*/]+)\s+(?:\*|[\d,\-*/]+)\s+(?:\*|[\d,\-*/]+)$/.test(value.value)) {
    return value.value;
  }
  for (const nested of Object.values(value)) {
    const found = findScheduleValue(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

function findRuntimeMinutes(value, depth = 0) {
  if (!value || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRuntimeMinutes(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const key of ["maxRuntime", "max_runtime", "maxRuntimeMinutes", "max_runtime_minutes"]) {
    const raw = value[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  for (const nested of Object.values(value)) {
    const found = findRuntimeMinutes(nested, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function checkCronMonitors({ inventory, monitors }) {
  const enabledMonitors = monitors.filter(isMonitorEnabled);
  const matches = [];
  const issues = [];

  for (const expected of inventory) {
    const matching = enabledMonitors.filter((monitor) =>
      monitorNames(monitor).some((name) => normalizedSlug(name) === normalizedSlug(expected.monitorSlug)),
    );
    if (matching.length === 0) {
      issues.push(`Missing enabled Sentry cron monitor for ${expected.monitorSlug}`);
      continue;
    }
    if (matching.length > 1) {
      issues.push(`Multiple enabled Sentry cron monitors match ${expected.monitorSlug}`);
      continue;
    }

    const monitor = matching[0];
    const schedule = findScheduleValue(monitor);
    if (!schedule) {
      issues.push(`Sentry cron monitor ${expected.monitorSlug} did not expose a crontab schedule`);
      continue;
    }
    if (schedule !== expected.schedule) {
      issues.push(`Sentry cron monitor ${expected.monitorSlug} schedule was ${schedule}, expected ${expected.schedule}`);
      continue;
    }

    matches.push({
      monitorId: monitor.id ?? null,
      monitorSlug: expected.monitorSlug,
      path: expected.path,
      schedule,
      sentryStatus: monitorStatus(monitor) || "enabled",
      maxRuntimeMinutes: findRuntimeMinutes(monitor),
    });
  }

  if (issues.length > 0) throw new Error(issues.join("; "));
  return {
    expectedCount: inventory.length,
    matchedCount: matches.length,
    monitors: matches,
  };
}

function serializeForSearch(value) {
  return JSON.stringify(value ?? {})
    .replace(/https:\/\/[^"\s]+/gi, "https://[redacted-url]")
    .toLowerCase();
}

function isEnabledAlertConfig(config) {
  const status = String(config.status ?? config.enabledStatus ?? "").toLowerCase();
  return config.disabled !== true && config.enabled !== false && status !== "disabled" && status !== "muted";
}

function hasNotificationAction(config) {
  const text = serializeForSearch(config);
  return [
    "slack",
    "email",
    "pagerduty",
    "opsgenie",
    "msteams",
    "discord",
    "webhook",
    "notification",
  ].some((needle) => text.includes(needle));
}

function alertConfigSummary(kind, config, requiredTerms) {
  const text = serializeForSearch(config);
  const matchedTerms = requiredTerms.filter((term) => text.includes(term.toLowerCase()));
  return {
    id: config.id ?? config.uuid ?? null,
    kind,
    matchedTerms,
    name: String(config.name ?? config.label ?? config.title ?? config.id ?? kind).slice(0, 120),
    notificationActionPresent: hasNotificationAction(config),
    status: String(config.status ?? (config.enabled === false ? "disabled" : "enabled")),
  };
}

function checkAlertRouting({ detectors, issueRules, requiredTerms, workflows }) {
  const rawConfigs = [
    ...workflows.map((config) => ["workflow", config]),
    ...issueRules.map((config) => ["issue-rule", config]),
    ...detectors.map((config) => ["detector", config]),
  ];
  const enabledConfigs = rawConfigs.filter(([, config]) => isEnabledAlertConfig(config));
  const actionableConfigs = enabledConfigs.filter(([, config]) => hasNotificationAction(config));
  if (actionableConfigs.length === 0) {
    throw new Error("No enabled Sentry workflow, detector, or issue alert rule exposes notification routing");
  }

  const combinedText = enabledConfigs.map(([, config]) => serializeForSearch(config)).join("\n");
  const missingTerms = requiredTerms.filter((term) => !combinedText.includes(term.toLowerCase()));
  if (missingTerms.length > 0) {
    throw new Error(`Sentry alert routing evidence missing launch terms: ${missingTerms.join(", ")}`);
  }

  return {
    enabledConfigCount: enabledConfigs.length,
    notificationConfigCount: actionableConfigs.length,
    requiredTerms,
    matchedTerms: requiredTerms,
    samples: actionableConfigs.slice(0, 20).map(([kind, config]) => alertConfigSummary(kind, config, requiredTerms)),
  };
}

export function buildEvidencePayload({ checks, config, issues, startedAt, completedAt, status }) {
  return {
    status,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    commitSha: process.env.SENTRY_CRON_PROOF_COMMIT_SHA || process.env.GITHUB_SHA || gitHead(),
    ciRunId: process.env.SENTRY_CRON_PROOF_CI_RUN_ID || process.env.GITHUB_RUN_ID || null,
    target: {
      baseUrl: config?.baseUrl?.origin ?? null,
      orgSlug: config?.orgSlug ?? null,
      projectSlug: config?.projectSlug ?? null,
    },
    checks,
    caveats: [
      "This proof reads Sentry monitor and alert configuration only; it does not replace dashboard screenshots or exported evidence for actual notification delivery tests.",
    ],
    issues: issues.slice(0, EVIDENCE_MAX_ISSUES).map(redact),
  };
}

function writeEvidence(config, payload) {
  mkdirSync(path.dirname(config.evidencePath), { recursive: true });
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runSentryCronAlertProof(env = process.env) {
  const startedAt = new Date().toISOString();
  let config;
  const checks = [];
  const issues = [];
  let status = "passed";

  try {
    config = parseConfig(env);
    const inventory = cronInventoryFromVercel();
    const monitors = await fetchSentryList(config, `/api/0/organizations/${encodeURIComponent(config.orgSlug)}/monitors/`);
    checks.push({
      name: "sentry-cron-monitors",
      status: "passed",
      ...(checkCronMonitors({ inventory, monitors })),
    });

    const [workflowsSource, detectorsSource, issueRulesSource] = await Promise.all([
      fetchOptionalSentryList(config, "workflows", `/api/0/organizations/${encodeURIComponent(config.orgSlug)}/workflows/`, {
        project: config.projectSlug,
      }),
      fetchOptionalSentryList(config, "detectors", `/api/0/organizations/${encodeURIComponent(config.orgSlug)}/detectors/`, {
        project: config.projectSlug,
      }),
      fetchOptionalSentryList(
        config,
        "issue-rules",
        `/api/0/projects/${encodeURIComponent(config.orgSlug)}/${encodeURIComponent(config.projectSlug)}/rules/`,
      ),
    ]);

    checks.push({
      name: "sentry-alert-routing",
      status: "passed",
      sources: [workflowsSource, detectorsSource, issueRulesSource].map((source) => ({
        name: source.name,
        rowCount: source.rows.length,
        status: source.status,
        error: source.error ?? null,
      })),
      ...(checkAlertRouting({
        detectors: detectorsSource.rows,
        issueRules: issueRulesSource.rows,
        requiredTerms: config.requiredAlertTerms,
        workflows: workflowsSource.rows,
      })),
    });
  } catch (error) {
    status = "failed";
    issues.push(safeError(error));
  }

  const completedAt = new Date().toISOString();
  const payload = buildEvidencePayload({ checks, config, issues, startedAt, completedAt, status });
  if (config) writeEvidence(config, payload);
  if (status !== "passed") {
    throw new Error(`Sentry cron alert proof failed: ${issues.join("; ")}`);
  }
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSentryCronAlertProof()
    .then((payload) => {
      console.log(`Sentry cron alert proof passed for ${payload.target.orgSlug}/${payload.target.projectSlug}`);
      console.log(`Sentry cron alert evidence written to ${process.env.SENTRY_CRON_PROOF_EVIDENCE_PATH}`);
    })
    .catch((error) => {
      console.error(safeError(error));
      process.exitCode = 1;
    });
}
