#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  FOUNDING_MAKER_CAP,
  maybeGrantFoundingMakerWithClient,
} from "../src/lib/foundingMakerCore.ts";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION_VALUE = "staging-or-local-write-delete";
const DEFAULT_SYNTHETIC_SELLERS = 8;
const DEFAULT_REPEAT_CALLS = 3;
const EVIDENCE_MAX_ISSUES = 20;

const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"')]+/gi;
const DB_ENV_ASSIGNMENT_PATTERN =
  /["']?\b(?:DATABASE_URL|DIRECT_URL|FOUNDING_MAKER_PROOF_[A-Z0-9_]+|PGPASSWORD)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const PASSWORD_ASSIGNMENT_PATTERN =
  /["']?\b(?:password|pass|pwd|PGPASSWORD)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const USERINFO_PATTERN = /\b[^\s:@/]+:[^\s@/]+@(?=[A-Za-z0-9.-]+\b)/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value) {
  return String(value ?? "")
    .replace(DB_ENV_ASSIGNMENT_PATTERN, "[redacted-founding-maker-proof-env]")
    .replace(POSTGRES_URL_PATTERN, "[redacted-postgres-url]")
    .replace(PASSWORD_ASSIGNMENT_PATTERN, "[redacted-password-assignment]")
    .replace(URL_USERINFO_PATTERN, "$1[redacted-credentials]@")
    .replace(USERINFO_PATTERN, "[redacted-credentials]@")
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

function parseBoundedInt(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw == null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function evidencePathFromEnv(env) {
  const raw = required(env, "FOUNDING_MAKER_PROOF_EVIDENCE_PATH");
  if (raw.includes("\0")) throw new Error("FOUNDING_MAKER_PROOF_EVIDENCE_PATH must not contain null bytes");
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("FOUNDING_MAKER_PROOF_EVIDENCE_PATH must stay inside the repository");
  }
  return resolved;
}

function databaseHostHash(databaseUrl) {
  try {
    return hashValue(new URL(databaseUrl).host);
  } catch {
    return null;
  }
}

export function parseConfig(env = process.env) {
  if (env.FOUNDING_MAKER_PROOF_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`FOUNDING_MAKER_PROOF_CONFIRM=${CONFIRMATION_VALUE} is required`);
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const syntheticSellerCount = parseBoundedInt(env, "FOUNDING_MAKER_PROOF_SYNTHETIC_SELLERS", DEFAULT_SYNTHETIC_SELLERS, {
    min: 2,
    max: 32,
  });
  return {
    databaseHostHash: databaseHostHash(databaseUrl),
    databaseUrl,
    evidencePath: evidencePathFromEnv(env),
    repeatCalls: parseBoundedInt(env, "FOUNDING_MAKER_PROOF_REPEAT_CALLS", DEFAULT_REPEAT_CALLS, {
      min: 1,
      max: 10,
    }),
    syntheticSellerCount,
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

function sampleSeller(row) {
  return {
    sellerIdHash: hashValue(row.id),
    foundingMakerNumber: row.foundingMakerNumber,
    grantIdHash: row.foundingMakerGrant?.id ? hashValue(row.foundingMakerGrant.id) : null,
  };
}

function emptyTracker() {
  return {
    grantIds: new Set(),
    listingIds: new Set(),
    sellerProfileIds: new Set(),
    userIds: new Set(),
  };
}

async function currentGrantMax(prisma) {
  const current = await prisma.foundingMakerGrant.aggregate({
    _max: { foundingMakerNumber: true },
  });
  return current._max.foundingMakerNumber ?? 0;
}

async function currentLedgerConsistency(prisma) {
  const [badProfileRows, badGrantRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "SellerProfile" sp
      LEFT JOIN "FoundingMakerGrant" fmg ON fmg."sellerProfileId" = sp.id
      WHERE sp."isFoundingMaker" = true
        AND (
          fmg.id IS NULL
          OR fmg."foundingMakerNumber" IS DISTINCT FROM sp."foundingMakerNumber"
        )
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "FoundingMakerGrant" fmg
      JOIN "SellerProfile" sp ON sp.id = fmg."sellerProfileId"
      WHERE sp."isFoundingMaker" = false
         OR sp."foundingMakerNumber" IS DISTINCT FROM fmg."foundingMakerNumber"
    `,
  ]);

  return {
    foundingProfilesMissingMatchingGrant: countValue(badProfileRows[0]?.count),
    linkedGrantsMissingMatchingProfileBadge: countValue(badGrantRows[0]?.count),
  };
}

async function createSyntheticSeller(prisma, tracker, runId, index) {
  const suffix = `${runId}-${index}`;
  const user = await prisma.user.create({
    data: {
      clerkId: `founding-maker-proof-${suffix}`,
      email: `founding-maker-proof-${suffix}@example.invalid`,
      name: `Founding Maker Proof ${index}`,
      termsAcceptedAt: new Date(),
      termsVersion: "proof",
      ageAttestedAt: new Date(),
    },
    select: { id: true },
  });
  tracker.userIds.add(user.id);

  const seller = await prisma.sellerProfile.create({
    data: {
      userId: user.id,
      displayName: `Founding Maker Proof ${index}`,
      displayNameNormalized: `founding maker proof ${index}`,
      chargesEnabled: true,
      stripeAccountVersion: "v2",
      vacationMode: false,
    },
    select: { id: true },
  });
  tracker.sellerProfileIds.add(seller.id);

  const listing = await prisma.listing.create({
    data: {
      sellerId: seller.id,
      title: `Founding Maker Proof Listing ${index}`,
      description: "Synthetic listing for the Founding Maker concurrency proof.",
      priceCents: 1000,
      status: "ACTIVE",
      isPrivate: false,
      listingType: "MADE_TO_ORDER",
      processingTimeMinDays: 1,
      processingTimeMaxDays: 3,
    },
    select: { id: true },
  });
  tracker.listingIds.add(listing.id);

  return { listingId: listing.id, sellerProfileId: seller.id, userId: user.id };
}

async function loadSyntheticSeller(prisma, sellerProfileId) {
  return prisma.sellerProfile.findUniqueOrThrow({
    where: { id: sellerProfileId },
    select: {
      id: true,
      isFoundingMaker: true,
      foundingMakerNumber: true,
      foundingMakerAt: true,
      foundingMakerGrant: {
        select: {
          id: true,
          foundingMakerNumber: true,
          grantedAt: true,
        },
      },
    },
  });
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function sortedNumbers(rows) {
  return rows.map((row) => row.foundingMakerNumber).sort((a, b) => a - b);
}

async function recordGrantIds(prisma, tracker, sellerProfileIds) {
  const grants = await prisma.foundingMakerGrant.findMany({
    where: { sellerProfileId: { in: sellerProfileIds } },
    select: { id: true },
  });
  for (const grant of grants) tracker.grantIds.add(grant.id);
}

async function createCapSentinelGrant(prisma, tracker, currentMax) {
  if (currentMax >= FOUNDING_MAKER_CAP) return null;
  const grant = await prisma.foundingMakerGrant.create({
    data: {
      foundingMakerNumber: FOUNDING_MAKER_CAP,
      grantedAt: new Date(),
    },
    select: { id: true, foundingMakerNumber: true },
  });
  tracker.grantIds.add(grant.id);
  return grant;
}

async function deleteSyntheticSellerProfile(prisma, synthetic, tracker) {
  await prisma.listing.deleteMany({ where: { id: synthetic.listingId } });
  tracker.listingIds.delete(synthetic.listingId);
  await prisma.sellerProfile.delete({ where: { id: synthetic.sellerProfileId } });
  tracker.sellerProfileIds.delete(synthetic.sellerProfileId);
}

async function cleanupSyntheticRows(prisma, tracker) {
  const result = {
    deletedListings: 0,
    deletedGrants: 0,
    deletedSellerProfiles: 0,
    deletedUsers: 0,
    issues: [],
  };

  const listingIds = [...tracker.listingIds];
  const grantIds = [...tracker.grantIds];
  const sellerProfileIds = [...tracker.sellerProfileIds];
  const userIds = [...tracker.userIds];

  try {
    if (listingIds.length > 0) {
      const deleted = await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
      result.deletedListings = deleted.count;
    }
  } catch (error) {
    result.issues.push(`listing cleanup failed: ${safeError(error)}`);
  }

  try {
    if (grantIds.length > 0 || sellerProfileIds.length > 0) {
      const deleted = await prisma.foundingMakerGrant.deleteMany({
        where: {
          OR: [
            grantIds.length > 0 ? { id: { in: grantIds } } : undefined,
            sellerProfileIds.length > 0 ? { sellerProfileId: { in: sellerProfileIds } } : undefined,
          ].filter(Boolean),
        },
      });
      result.deletedGrants = deleted.count;
    }
  } catch (error) {
    result.issues.push(`grant cleanup failed: ${safeError(error)}`);
  }

  try {
    if (sellerProfileIds.length > 0) {
      const deleted = await prisma.sellerProfile.deleteMany({ where: { id: { in: sellerProfileIds } } });
      result.deletedSellerProfiles = deleted.count;
    }
  } catch (error) {
    result.issues.push(`seller cleanup failed: ${safeError(error)}`);
  }

  try {
    if (userIds.length > 0) {
      const deleted = await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      result.deletedUsers = deleted.count;
    }
  } catch (error) {
    result.issues.push(`user cleanup failed: ${safeError(error)}`);
  }

  return result;
}

async function executeProof(prisma, config) {
  const tracker = emptyTracker();
  const runId = `gl-founding-maker-proof-${randomUUID()}`;
  const reports = [];
  let result = {
    status: "passed",
    actionableFindingCount: 0,
    reports,
    proof: null,
    issues: [],
    cleanup: null,
  };

  try {
    const baselineMax = await currentGrantMax(prisma);
    const baselineConsistency = await currentLedgerConsistency(prisma);
    reports.push({ name: "baseline-ledger-consistency", ...baselineConsistency });

    assertCondition(baselineMax <= FOUNDING_MAKER_CAP, "Founding Maker grant ledger exceeds the cap");
    assertCondition(
      baselineConsistency.foundingProfilesMissingMatchingGrant === 0 &&
        baselineConsistency.linkedGrantsMissingMatchingProfileBadge === 0,
      "Founding Maker profile/grant ledger drift must be reconciled before running the concurrency proof",
    );
    assertCondition(
      baselineMax + config.syntheticSellerCount + 1 <= FOUNDING_MAKER_CAP,
      `Founding Maker proof needs ${config.syntheticSellerCount + 1} open grant numbers for synthetic concurrency plus gap-reuse checks`,
    );

    const syntheticSellers = [];
    for (let i = 0; i < config.syntheticSellerCount; i += 1) {
      syntheticSellers.push(await createSyntheticSeller(prisma, tracker, runId, i + 1));
    }

    await Promise.all(
      syntheticSellers.flatMap((seller) =>
        Array.from({ length: config.repeatCalls }, () =>
          maybeGrantFoundingMakerWithClient(prisma, seller.sellerProfileId),
        ),
      ),
    );
    await recordGrantIds(prisma, tracker, syntheticSellers.map((seller) => seller.sellerProfileId));

    const grantedRows = await Promise.all(
      syntheticSellers.map((seller) => loadSyntheticSeller(prisma, seller.sellerProfileId)),
    );
    const assignedNumbers = sortedNumbers(grantedRows);
    const expectedNumbers = Array.from(
      { length: config.syntheticSellerCount },
      (_, index) => baselineMax + index + 1,
    );
    assertCondition(
      grantedRows.every((row) => row.isFoundingMaker && row.foundingMakerGrant),
      "Every synthetic concurrent seller should receive exactly one grant-backed Founding Maker badge",
    );
    assertCondition(
      new Set(assignedNumbers).size === assignedNumbers.length,
      "Concurrent Founding Maker grants produced duplicate numbers",
    );
    assertCondition(
      JSON.stringify(assignedNumbers) === JSON.stringify(expectedNumbers),
      "Concurrent Founding Maker grants did not assign the expected contiguous next numbers",
    );
    assertCondition(
      grantedRows.every((row) => row.foundingMakerNumber === row.foundingMakerGrant?.foundingMakerNumber),
      "SellerProfile Founding Maker display fields must mirror the durable grant ledger",
    );

    const firstGranted = grantedRows.toSorted((a, b) => a.foundingMakerNumber - b.foundingMakerNumber)[0];
    const firstSynthetic = syntheticSellers.find((seller) => seller.sellerProfileId === firstGranted.id);
    assertCondition(firstSynthetic, "Could not find the first synthetic seller for gap-reuse proof");
    await deleteSyntheticSellerProfile(prisma, firstSynthetic, tracker);

    const replacement = await createSyntheticSeller(prisma, tracker, runId, "gap-replacement");
    await maybeGrantFoundingMakerWithClient(prisma, replacement.sellerProfileId);
    await recordGrantIds(prisma, tracker, [replacement.sellerProfileId]);
    const replacementRow = await loadSyntheticSeller(prisma, replacement.sellerProfileId);
    const expectedReplacementNumber = baselineMax + config.syntheticSellerCount + 1;
    assertCondition(
      replacementRow.foundingMakerNumber === expectedReplacementNumber,
      "Durable grant ledger should not reuse a lower hard-deleted synthetic seller number",
    );

    const currentMaxAfterReplacement = await currentGrantMax(prisma);
    const sentinel = await createCapSentinelGrant(prisma, tracker, currentMaxAfterReplacement);
    const capCandidate = await createSyntheticSeller(prisma, tracker, runId, "cap-candidate");
    await maybeGrantFoundingMakerWithClient(prisma, capCandidate.sellerProfileId);
    const capCandidateRow = await loadSyntheticSeller(prisma, capCandidate.sellerProfileId);
    assertCondition(
      !capCandidateRow.isFoundingMaker && !capCandidateRow.foundingMakerNumber && !capCandidateRow.foundingMakerGrant,
      "Founding Maker grant should fail closed when the durable ledger is at the cap",
    );

    const finalConsistency = await currentLedgerConsistency(prisma);
    reports.push({ name: "final-ledger-consistency", ...finalConsistency });
    assertCondition(
      finalConsistency.foundingProfilesMissingMatchingGrant === 0 &&
        finalConsistency.linkedGrantsMissingMatchingProfileBadge === 0,
      "Founding Maker profile/grant ledger drift appeared during the proof",
    );

    result = {
      status: "passed",
      actionableFindingCount: 0,
      reports,
      proof: {
        baselineMax,
        concurrentSyntheticSellers: config.syntheticSellerCount,
        repeatedCallsPerSeller: config.repeatCalls,
        assignedNumberRange: {
          first: assignedNumbers[0],
          last: assignedNumbers[assignedNumbers.length - 1],
        },
        sampleGrantedSellers: grantedRows.slice(0, 5).map(sampleSeller),
        gapReuseCheck: {
          deletedGrantNumber: firstGranted.foundingMakerNumber,
          replacementGrantNumber: replacementRow.foundingMakerNumber,
        },
        capCheck: {
          sentinelGrantNumber: sentinel?.foundingMakerNumber ?? FOUNDING_MAKER_CAP,
          capCandidateGranted: capCandidateRow.isFoundingMaker,
        },
      },
      issues: [],
      cleanup: null,
    };
  } catch (error) {
    result = {
      status: "failed",
      actionableFindingCount: 1,
      reports,
      proof: result.proof,
      issues: [safeError(error)],
      cleanup: null,
    };
  } finally {
    result.cleanup = await cleanupSyntheticRows(prisma, tracker);
  }

  return result;
}

export function buildEvidencePayload({ config, result, status, startedAt, completedAt, issues }) {
  return {
    status,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    commitSha: process.env.FOUNDING_MAKER_PROOF_COMMIT_SHA || process.env.GITHUB_SHA || gitHead(),
    ciRunId: process.env.FOUNDING_MAKER_PROOF_CI_RUN_ID || process.env.GITHUB_RUN_ID || null,
    database: {
      hostHash: config?.databaseHostHash ?? null,
    },
    confirmation: CONFIRMATION_VALUE,
    actionableFindingCount: result?.actionableFindingCount ?? (status === "passed" ? 0 : 1),
    reports: result?.reports ?? [],
    proof: result?.proof ?? null,
    cleanup: result?.cleanup ?? null,
    issues: issues.slice(0, EVIDENCE_MAX_ISSUES).map(redact),
  };
}

function writeEvidence(config, payload) {
  mkdirSync(path.dirname(config.evidencePath), { recursive: true });
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runFoundingMakerConcurrencyProof(env = process.env) {
  const startedAt = new Date().toISOString();
  const issues = [];
  let config;
  let result = null;
  let status = "passed";
  let prisma;

  try {
    config = parseConfig(env);
    prisma = createPrismaClient(config.databaseUrl);
    await prisma.$connect();
    result = await executeProof(prisma, config);
    if (result.cleanup?.issues?.length) {
      status = "failed";
      issues.push(...result.cleanup.issues);
    } else {
      status = result.status;
    }
    issues.push(...(result.issues ?? []));
  } catch (error) {
    status = "failed";
    issues.push(safeError(error));
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
  }

  const completedAt = new Date().toISOString();
  const payload = buildEvidencePayload({
    config,
    result,
    status,
    startedAt,
    completedAt,
    issues,
  });
  if (config) writeEvidence(config, payload);
  if (status !== "passed") {
    throw new Error(`Founding Maker concurrency proof failed: ${issues.join("; ")}`);
  }
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFoundingMakerConcurrencyProof()
    .then((payload) => {
      console.log(`Founding Maker concurrency proof passed with ${payload.actionableFindingCount} actionable findings`);
      console.log(`Founding Maker evidence written to ${process.env.FOUNDING_MAKER_PROOF_EVIDENCE_PATH}`);
    })
    .catch((error) => {
      console.error(safeError(error));
      process.exitCode = 1;
    });
}
