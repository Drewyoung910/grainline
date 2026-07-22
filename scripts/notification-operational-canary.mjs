#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { createClerkClient } from "@clerk/backend";
import { parse as parseDotenv } from "dotenv";
import pg from "pg";

const { Client } = pg;

export const NOTIFICATION_CANARY_EXTERNAL_ID =
  "grainline-notification-rls-operational-canary-v1";
export const NOTIFICATION_CANARY_PURPOSE = "notification-rls-route-and-production-canary";
export const REVIEWED_TERMS_VERSION = "2026-06-14";

const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
const EVIDENCE_PATH =
  "/Users/drewyoung/grainline-rollout-evidence/notification-operational-canary-20260722.json";
const PRODUCTION_DATABASE_IDENTITY = Object.freeze({
  databaseName: "neondb",
  endpointId: "ep-plain-river-aaqg8gj4",
  region: "westus3.azure",
  role: "grainline_app_runtime",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPrivateRegularFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private regular file`);
  }
}

function readLocalEnvironment() {
  assertPrivateRegularFile(LOCAL_ENV_PATH, "local environment file");
  return parseDotenv(readFileSync(LOCAL_ENV_PATH));
}

function productionCredentials() {
  const values = readLocalEnvironment();
  const databaseUrl = values.DATABASE_URL;
  const secretKey = values.CLERK_SECRET_KEY;
  const publishableKey = values.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (
    typeof databaseUrl !== "string"
    || typeof secretKey !== "string"
    || !secretKey.startsWith("sk_live_")
    || typeof publishableKey !== "string"
    || !publishableKey.startsWith("pk_live_")
  ) {
    throw new Error("operational canary requires reviewed live Clerk and runtime DB credentials");
  }
  const parsed = new URL(databaseUrl);
  const expectedHost = `${PRODUCTION_DATABASE_IDENTITY.endpointId}-pooler.${PRODUCTION_DATABASE_IDENTITY.region}.neon.tech`;
  if (
    parsed.protocol !== "postgresql:"
    || parsed.hostname !== expectedHost
    || parsed.username !== PRODUCTION_DATABASE_IDENTITY.role
    || parsed.pathname !== `/${PRODUCTION_DATABASE_IDENTITY.databaseName}`
    || !parsed.password
    || parsed.searchParams.get("sslmode") !== "verify-full"
    || parsed.searchParams.get("channel_binding") !== "require"
  ) {
    throw new Error("operational canary database URL is not the reviewed production runtime identity");
  }
  return { databaseUrl, secretKey };
}

function writePrivateEvidence(value, sensitiveValues) {
  if (existsSync(EVIDENCE_PATH)) {
    throw new Error("operational canary evidence already exists; use status instead of recreating it");
  }
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  for (const sensitive of sensitiveValues) {
    if (sensitive && serialized.includes(sensitive)) {
      throw new Error("operational canary evidence retained a raw identifier or credential");
    }
  }
  const fd = openSync(EVIDENCE_PATH, "wx", 0o600);
  try {
    writeFileSync(fd, serialized, "utf8");
  } finally {
    closeSync(fd);
  }
  chmodSync(EVIDENCE_PATH, 0o600);
  assertPrivateRegularFile(EVIDENCE_PATH, "operational canary evidence");
}

async function exactClerkCanary(clerk) {
  const page = await clerk.users.getUserList({
    externalId: [NOTIFICATION_CANARY_EXTERNAL_ID],
    limit: 2,
  });
  if (page.totalCount > 1 || page.data.length > 1) {
    throw new Error("more than one Clerk operational canary exists");
  }
  return page.data[0] ?? null;
}

function assertCanaryShape(user) {
  if (
    !user
    || user.externalId !== NOTIFICATION_CANARY_EXTERNAL_ID
    || user.banned === true
    || user.locked === true
    || user.firstName !== "Grainline"
    || user.lastName !== "Notification Canary"
    || user.emailAddresses.length !== 0
    || user.phoneNumbers.length !== 0
    || user.publicMetadata?.grainlineOperationalCanary !== NOTIFICATION_CANARY_PURPOSE
  ) {
    throw new Error("Clerk operational canary shape drifted");
  }
  return user;
}

async function waitForProductionUser(client, clerkId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await client.query(
      `SELECT id, email, "termsAcceptedAt", "termsVersion", "ageAttestedAt",
              "welcomeEmailSentAt", banned, "deletedAt"
         FROM public."User"
        WHERE "clerkId" = $1`,
      [clerkId],
    );
    if (result.rowCount === 1) return result.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("production Clerk webhook did not create the operational canary row in time");
}

async function assertNoMarketplaceActivity(client, userId) {
  const result = await client.query(
    `SELECT
       (SELECT count(*) FROM public."Order" WHERE "buyerId" = $1)
       + (SELECT count(*) FROM public."Message" WHERE "senderId" = $1 OR "recipientId" = $1)
       + (SELECT count(*) FROM public."SellerProfile" WHERE "userId" = $1)
       + (SELECT count(*) FROM public."Favorite" WHERE "userId" = $1)
       + (SELECT count(*) FROM public."SavedSearch" WHERE "userId" = $1)
       + (SELECT count(*) FROM public."Notification" WHERE "userId" = $1)
       AS count`,
    [userId],
  );
  if (Number(result.rows[0]?.count) !== 0) {
    throw new Error("operational canary unexpectedly has marketplace activity");
  }
}

async function ensureCanary() {
  const { databaseUrl, secretKey } = productionCredentials();
  const clerk = createClerkClient({ secretKey });
  let canary = await exactClerkCanary(clerk);
  let created = false;
  if (!canary) {
    const acceptedAt = new Date();
    canary = await clerk.users.createUser({
      externalId: NOTIFICATION_CANARY_EXTERNAL_ID,
      firstName: "Grainline",
      lastName: "Notification Canary",
      skipLegalChecks: true,
      skipPasswordRequirement: true,
      legalAcceptedAt: acceptedAt,
      publicMetadata: {
        grainlineOperationalCanary: NOTIFICATION_CANARY_PURPOSE,
      },
      privateMetadata: {
        managedBy: "grainline-rls-operator",
        doNotUseForCustomerActivity: true,
      },
      unsafeMetadata: {
        ageAttestedAt: acceptedAt.toISOString(),
        termsAcceptedAt: acceptedAt.toISOString(),
        termsVersion: REVIEWED_TERMS_VERSION,
      },
    });
    created = true;
  }
  assertCanaryShape(canary);

  const client = new Client({
    application_name: "notification-operational-canary",
    connectionString: databaseUrl,
  });
  await client.connect();
  let localUser;
  try {
    const identity = await client.query(
      `SELECT current_user AS "currentUser", current_database() AS "databaseName"`,
    );
    if (
      identity.rows[0]?.currentUser !== PRODUCTION_DATABASE_IDENTITY.role
      || identity.rows[0]?.databaseName !== PRODUCTION_DATABASE_IDENTITY.databaseName
    ) {
      throw new Error("operational canary connected with an unexpected database identity");
    }
    localUser = await waitForProductionUser(client, canary.id);
    if (
      localUser.email !== `${canary.id}@placeholder.invalid`
      || !localUser.termsAcceptedAt
      || localUser.termsVersion !== REVIEWED_TERMS_VERSION
      || !localUser.ageAttestedAt
      || localUser.welcomeEmailSentAt !== null
      || localUser.banned !== false
      || localUser.deletedAt !== null
    ) {
      throw new Error("production operational canary row did not match the reviewed inactive shape");
    }
    await assertNoMarketplaceActivity(client, localUser.id);
  } finally {
    await client.end().catch(() => {});
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    scope: "notification-operational-canary",
    status: "ready",
    externalId: NOTIFICATION_CANARY_EXTERNAL_ID,
    created,
    clerk: {
      active: true,
      clerkIdSha256: sha256(canary.id),
      hasEmail: false,
      hasPassword: canary.passwordEnabled,
      purposeMarked: true,
    },
    database: {
      databaseName: PRODUCTION_DATABASE_IDENTITY.databaseName,
      endpointId: PRODUCTION_DATABASE_IDENTITY.endpointId,
      localUserIdSha256: sha256(localUser.id),
      marketplaceActivityRows: 0,
      role: PRODUCTION_DATABASE_IDENTITY.role,
      termsCurrent: true,
      welcomeEmailReserved: false,
    },
    rawIdentifiersRetained: false,
    credentialsRetained: false,
  };
  writePrivateEvidence(evidence, [
    databaseUrl,
    new URL(databaseUrl).password,
    secretKey,
    canary.id,
    localUser.id,
    localUser.email,
  ]);
  console.log(JSON.stringify({
    operationalCanary: "ready",
    created,
    hasEmail: false,
    marketplaceActivityRows: 0,
    termsCurrent: true,
  }));
}

async function status() {
  const { databaseUrl, secretKey } = productionCredentials();
  const clerk = createClerkClient({ secretKey });
  const canary = assertCanaryShape(await exactClerkCanary(clerk));
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const localUser = await waitForProductionUser(client, canary.id);
    await assertNoMarketplaceActivity(client, localUser.id);
    console.log(JSON.stringify({ operationalCanary: "ready", marketplaceActivityRows: 0 }));
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if (process.argv[2] === "ensure") return ensureCanary();
  if (process.argv[2] === "status") return status();
  throw new Error("Usage: node scripts/notification-operational-canary.mjs <ensure|status>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "operational canary command failed");
    process.exitCode = 1;
  });
}
