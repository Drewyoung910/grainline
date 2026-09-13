#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION_VALUE = "read-only";
const DEFAULT_ALLOWED_CURRENCIES = ["usd"];
const DEFAULT_SAMPLE_LIMIT = 20;
const EVIDENCE_MAX_ISSUES = 20;

const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"')]+/gi;
const DB_ENV_ASSIGNMENT_PATTERN =
  /["']?\b(?:DATABASE_URL|DIRECT_URL|SHIPPING_CURRENCY_PROOF_[A-Z0-9_]+|PGPASSWORD)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const PASSWORD_ASSIGNMENT_PATTERN =
  /["']?\b(?:password|pass|pwd|PGPASSWORD)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value) {
  return String(value ?? "")
    .replace(DB_ENV_ASSIGNMENT_PATTERN, "[redacted-shipping-currency-proof-env]")
    .replace(POSTGRES_URL_PATTERN, "[redacted-postgres-url]")
    .replace(PASSWORD_ASSIGNMENT_PATTERN, "[redacted-password-assignment]")
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

function hashValue(value) {
  return createHash("sha256").update(String(value ?? "")).digest("base64url").slice(0, 16);
}

function evidencePathFromEnv(env) {
  const raw = required(env, "SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH");
  if (raw.includes("\0")) throw new Error("SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH must not contain null bytes");
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH must stay inside the repository");
  }
  return resolved;
}

function parseAllowedCurrencies(value) {
  const currencies = (value || DEFAULT_ALLOWED_CURRENCIES.join(","))
    .split(",")
    .map((currency) => currency.trim().toLowerCase())
    .filter(Boolean);
  if (currencies.length === 0) throw new Error("SHIPPING_CURRENCY_PROOF_ALLOWED_CURRENCIES must include at least one currency");
  for (const currency of currencies) {
    if (!/^[a-z]{3}$/.test(currency)) {
      throw new Error("SHIPPING_CURRENCY_PROOF_ALLOWED_CURRENCIES must contain comma-separated ISO currency codes");
    }
  }
  return [...new Set(currencies)].sort();
}

function parseSampleLimit(value) {
  if (value == null || value === "") return DEFAULT_SAMPLE_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("SHIPPING_CURRENCY_PROOF_SAMPLE_LIMIT must be an integer from 1 to 100");
  }
  return parsed;
}

function databaseHostHash(databaseUrl) {
  try {
    return hashValue(new URL(databaseUrl).host);
  } catch {
    return null;
  }
}

export function parseConfig(env = process.env) {
  if (env.SHIPPING_CURRENCY_PROOF_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`SHIPPING_CURRENCY_PROOF_CONFIRM=${CONFIRMATION_VALUE} is required`);
  }
  const databaseUrl = required(env, "DATABASE_URL");
  return {
    allowedCurrencies: parseAllowedCurrencies(env.SHIPPING_CURRENCY_PROOF_ALLOWED_CURRENCIES),
    databaseUrl,
    databaseHostHash: databaseHostHash(databaseUrl),
    evidencePath: evidencePathFromEnv(env),
    sampleLimit: parseSampleLimit(env.SHIPPING_CURRENCY_PROOF_SAMPLE_LIMIT),
  };
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function createPrismaClient(databaseUrl) {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

function countValue(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(value ?? 0);
}

function firstCount(rows) {
  return countValue(rows?.[0]?.count);
}

function currencyCounts(rows) {
  return rows.map((row) => ({
    currency: String(row.currency ?? "").toLowerCase() || "(empty)",
    count: countValue(row._count?._all),
  }));
}

function sampleListing(row) {
  return {
    listingIdHash: hashValue(row.id),
    sellerIdHash: hashValue(row.sellerId),
    currency: String(row.currency ?? "").toLowerCase() || null,
    status: row.status ?? null,
  };
}

function sampleOrder(row) {
  return {
    orderIdHash: hashValue(row.id),
    currency: String(row.currency ?? "").toLowerCase() || null,
    shippingAmountCents: row.shippingAmountCents ?? null,
    quotedShippingAmountCents: row.quotedShippingAmountCents ?? null,
    labelCostCents: row.labelCostCents ?? null,
    paid: Boolean(row.paidAt),
  };
}

function sampleSeller(row) {
  return {
    sellerIdHash: hashValue(row.id),
    listingCount: countValue(row.listing_count),
    currencies: Array.isArray(row.currencies)
      ? row.currencies.map((currency) => String(currency).toLowerCase()).sort()
      : [],
    hasFlatRate: row.has_flat_rate === true,
    hasFreeShippingThreshold: row.has_free_shipping_threshold === true,
  };
}

function sampleQuoteMismatch(row) {
  return {
    quoteIdHash: hashValue(row.id),
    orderIdHash: hashValue(row.orderId),
    orderCurrency: String(row.orderCurrency ?? "").toLowerCase() || null,
    rateCurrency: String(row.rateCurrency ?? "").toLowerCase() || null,
    rateObjectIdHash: row.rateObjectId ? hashValue(row.rateObjectId) : null,
  };
}

function allowedCurrencySql(allowedCurrencies) {
  return Prisma.join(allowedCurrencies.map((currency) => Prisma.sql`${currency}`));
}

async function collectFindings(prisma, config) {
  const allowedSql = allowedCurrencySql(config.allowedCurrencies);
  const sampleLimit = config.sampleLimit;

  const [
    listingCurrencyRows,
    orderCurrencyRows,
    sellerShippingSettingsCount,
    nonAllowedListingCountRows,
    nonAllowedListingRows,
    nonAllowedOrderCountRows,
    nonAllowedOrderRows,
    currencylessNonAllowedSellerCountRows,
    currencylessNonAllowedSellerRows,
    currencylessMixedSellerCountRows,
    currencylessMixedSellerRows,
    nonAllowedPaidShippingOrderCountRows,
    nonAllowedPaidShippingOrderRows,
    nonAllowedLabelCostOrderCountRows,
    nonAllowedLabelCostOrderRows,
    quoteMismatchCountRows,
    quoteMismatchRows,
  ] = await Promise.all([
    prisma.listing.groupBy({ by: ["currency"], _count: { _all: true }, orderBy: { currency: "asc" } }),
    prisma.order.groupBy({ by: ["currency"], _count: { _all: true }, orderBy: { currency: "asc" } }),
    prisma.sellerProfile.count({
      where: {
        OR: [
          { shippingFlatRateCents: { not: null } },
          { freeShippingOverCents: { not: null } },
        ],
      },
    }),
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "Listing"
      WHERE LOWER(COALESCE("currency", '')) NOT IN (${allowedSql})
    `,
    prisma.$queryRaw`
      SELECT id, "sellerId", currency, status
      FROM "Listing"
      WHERE LOWER(COALESCE("currency", '')) NOT IN (${allowedSql})
      ORDER BY "updatedAt" DESC, id ASC
      LIMIT ${sampleLimit}
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "Order"
      WHERE LOWER(COALESCE("currency", '')) NOT IN (${allowedSql})
    `,
    prisma.$queryRaw`
      SELECT id, currency, "shippingAmountCents", "quotedShippingAmountCents", "labelCostCents", "paidAt"
      FROM "Order"
      WHERE LOWER(COALESCE("currency", '')) NOT IN (${allowedSql})
      ORDER BY "createdAt" DESC, id ASC
      LIMIT ${sampleLimit}
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT sp.id
        FROM "SellerProfile" sp
        JOIN "Listing" l ON l."sellerId" = sp.id
        WHERE (sp."shippingFlatRateCents" IS NOT NULL OR sp."freeShippingOverCents" IS NOT NULL)
          AND LOWER(COALESCE(l."currency", '')) NOT IN (${allowedSql})
        GROUP BY sp.id
      ) drift
    `,
    prisma.$queryRaw`
      SELECT
        sp.id,
        COUNT(l.id)::int AS listing_count,
        ARRAY_AGG(DISTINCT LOWER(COALESCE(l."currency", ''))) AS currencies,
        (sp."shippingFlatRateCents" IS NOT NULL) AS has_flat_rate,
        (sp."freeShippingOverCents" IS NOT NULL) AS has_free_shipping_threshold
      FROM "SellerProfile" sp
      JOIN "Listing" l ON l."sellerId" = sp.id
      WHERE (sp."shippingFlatRateCents" IS NOT NULL OR sp."freeShippingOverCents" IS NOT NULL)
        AND LOWER(COALESCE(l."currency", '')) NOT IN (${allowedSql})
      GROUP BY sp.id, has_flat_rate, has_free_shipping_threshold
      ORDER BY sp.id ASC
      LIMIT ${sampleLimit}
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT sp.id
        FROM "SellerProfile" sp
        JOIN "Listing" l ON l."sellerId" = sp.id
        WHERE sp."shippingFlatRateCents" IS NOT NULL OR sp."freeShippingOverCents" IS NOT NULL
        GROUP BY sp.id
        HAVING COUNT(DISTINCT LOWER(COALESCE(l."currency", ''))) > 1
      ) drift
    `,
    prisma.$queryRaw`
      SELECT
        sp.id,
        COUNT(l.id)::int AS listing_count,
        ARRAY_AGG(DISTINCT LOWER(COALESCE(l."currency", ''))) AS currencies,
        (sp."shippingFlatRateCents" IS NOT NULL) AS has_flat_rate,
        (sp."freeShippingOverCents" IS NOT NULL) AS has_free_shipping_threshold
      FROM "SellerProfile" sp
      JOIN "Listing" l ON l."sellerId" = sp.id
      WHERE sp."shippingFlatRateCents" IS NOT NULL OR sp."freeShippingOverCents" IS NOT NULL
      GROUP BY sp.id, has_flat_rate, has_free_shipping_threshold
      HAVING COUNT(DISTINCT LOWER(COALESCE(l."currency", ''))) > 1
      ORDER BY sp.id ASC
      LIMIT ${sampleLimit}
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "Order"
      WHERE "paidAt" IS NOT NULL
        AND ("shippingAmountCents" > 0 OR COALESCE("quotedShippingAmountCents", 0) > 0)
        AND LOWER(COALESCE("currency", '')) NOT IN (${allowedSql})
    `,
    prisma.$queryRaw`
      SELECT id, currency, "shippingAmountCents", "quotedShippingAmountCents", "labelCostCents", "paidAt"
      FROM "Order"
      WHERE "paidAt" IS NOT NULL
        AND ("shippingAmountCents" > 0 OR COALESCE("quotedShippingAmountCents", 0) > 0)
        AND LOWER(COALESCE("currency", '')) NOT IN (${allowedSql})
      ORDER BY "createdAt" DESC, id ASC
      LIMIT ${sampleLimit}
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "Order"
      WHERE "labelCostCents" IS NOT NULL
        AND LOWER(COALESCE("currency", '')) NOT IN (${allowedSql})
    `,
    prisma.$queryRaw`
      SELECT id, currency, "shippingAmountCents", "quotedShippingAmountCents", "labelCostCents", "paidAt"
      FROM "Order"
      WHERE "labelCostCents" IS NOT NULL
        AND LOWER(COALESCE("currency", '')) NOT IN (${allowedSql})
      ORDER BY "createdAt" DESC, id ASC
      LIMIT ${sampleLimit}
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "OrderShippingRateQuote" q
      JOIN "Order" o ON o.id = q."orderId"
      CROSS JOIN LATERAL jsonb_array_elements(q."rates") rate
      WHERE LOWER(COALESCE(rate->>'currency', '')) != LOWER(COALESCE(o."currency", ''))
    `,
    prisma.$queryRaw`
      SELECT
        q.id,
        q."orderId",
        o."currency" AS "orderCurrency",
        rate->>'currency' AS "rateCurrency",
        rate->>'objectId' AS "rateObjectId"
      FROM "OrderShippingRateQuote" q
      JOIN "Order" o ON o.id = q."orderId"
      CROSS JOIN LATERAL jsonb_array_elements(q."rates") rate
      WHERE LOWER(COALESCE(rate->>'currency', '')) != LOWER(COALESCE(o."currency", ''))
      ORDER BY q."createdAt" DESC, q.id ASC
      LIMIT ${sampleLimit}
    `,
  ]);

  const findings = {
    allowedCurrencies: config.allowedCurrencies,
    listingCurrencyCounts: currencyCounts(listingCurrencyRows),
    orderCurrencyCounts: currencyCounts(orderCurrencyRows),
    sellerCurrencylessShippingSettings: {
      count: sellerShippingSettingsCount,
    },
    nonAllowedListingCurrencies: {
      count: firstCount(nonAllowedListingCountRows),
      samples: nonAllowedListingRows.map(sampleListing),
    },
    nonAllowedOrderCurrencies: {
      count: firstCount(nonAllowedOrderCountRows),
      samples: nonAllowedOrderRows.map(sampleOrder),
    },
    currencylessShippingWithNonAllowedListings: {
      count: firstCount(currencylessNonAllowedSellerCountRows),
      samples: currencylessNonAllowedSellerRows.map(sampleSeller),
    },
    currencylessShippingWithMixedListingCurrencies: {
      count: firstCount(currencylessMixedSellerCountRows),
      samples: currencylessMixedSellerRows.map(sampleSeller),
    },
    nonAllowedPaidShippingOrders: {
      count: firstCount(nonAllowedPaidShippingOrderCountRows),
      samples: nonAllowedPaidShippingOrderRows.map(sampleOrder),
    },
    nonAllowedLabelCostOrders: {
      count: firstCount(nonAllowedLabelCostOrderCountRows),
      samples: nonAllowedLabelCostOrderRows.map(sampleOrder),
    },
    quoteRateCurrencyMismatches: {
      count: firstCount(quoteMismatchCountRows),
      samples: quoteMismatchRows.map(sampleQuoteMismatch),
    },
  };

  const actionableCount =
    findings.nonAllowedListingCurrencies.count +
    findings.nonAllowedOrderCurrencies.count +
    findings.currencylessShippingWithNonAllowedListings.count +
    findings.currencylessShippingWithMixedListingCurrencies.count +
    findings.nonAllowedPaidShippingOrders.count +
    findings.nonAllowedLabelCostOrders.count +
    findings.quoteRateCurrencyMismatches.count;

  return { findings, actionableCount };
}

export function buildEvidencePayload({ config, status, startedAt, completedAt, findings, actionableCount, issues }) {
  return {
    status,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    commitSha: process.env.SHIPPING_CURRENCY_PROOF_COMMIT_SHA || process.env.GITHUB_SHA || gitHead(),
    ciRunId: process.env.SHIPPING_CURRENCY_PROOF_CI_RUN_ID || process.env.GITHUB_RUN_ID || null,
    database: {
      hostHash: config?.databaseHostHash ?? null,
    },
    allowedCurrencies: config?.allowedCurrencies ?? [],
    actionableFindingCount: actionableCount,
    findings,
    issues: issues.slice(0, EVIDENCE_MAX_ISSUES).map(redact),
  };
}

function writeEvidence(config, payload) {
  mkdirSync(path.dirname(config.evidencePath), { recursive: true });
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runShippingCurrencyDriftProof(env = process.env) {
  const startedAt = new Date().toISOString();
  const issues = [];
  let config;
  let findings = null;
  let actionableCount = 0;
  let status = "passed";
  let prisma;

  try {
    config = parseConfig(env);
    prisma = createPrismaClient(config.databaseUrl);
    await prisma.$connect();
    const collected = await collectFindings(prisma, config);
    findings = collected.findings;
    actionableCount = collected.actionableCount;
    if (actionableCount > 0) {
      status = "failed";
      issues.push(`shipping currency drift scan found ${actionableCount} actionable row groups/items`);
    }
  } catch (error) {
    status = "failed";
    issues.push(safeError(error));
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
  }

  const completedAt = new Date().toISOString();
  const payload = buildEvidencePayload({
    config,
    status,
    startedAt,
    completedAt,
    findings,
    actionableCount,
    issues,
  });
  if (config) writeEvidence(config, payload);
  if (status !== "passed") {
    throw new Error(`Shipping currency drift proof failed: ${issues.join("; ")}`);
  }
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runShippingCurrencyDriftProof()
    .then((payload) => {
      console.log(`Shipping currency drift proof passed with ${payload.actionableFindingCount} actionable findings`);
      console.log(`Shipping currency drift evidence written to ${process.env.SHIPPING_CURRENCY_PROOF_EVIDENCE_PATH}`);
    })
    .catch((error) => {
      console.error(safeError(error));
      process.exitCode = 1;
    });
}
