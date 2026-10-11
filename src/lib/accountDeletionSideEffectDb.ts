import "server-only";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runtimeDatabasePoolOptions } from "@/lib/databaseUrl";

export const ACCOUNT_DELETION_DATABASE_ENV = "ACCOUNT_DELETION_DATABASE_URL";
export const ACCOUNT_DELETION_DATABASE_ROLE = "grainline_account_deletion_runtime";

const globalForAccountDeletion = globalThis as unknown as {
  accountDeletionPrisma?: PrismaClient;
};

function parsePostgresUrl(value: string, label: string) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty PostgreSQL URL without surrounding whitespace`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${label} must use the postgres or postgresql protocol`);
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") {
    throw new Error(`${label} must identify an explicit database`);
  }
  return parsed;
}

export function assertAccountDeletionDatabaseBoundary(
  accountDeletionConnectionString: string,
  ordinaryConnectionString?: string,
) {
  const accountDeletion = parsePostgresUrl(
    accountDeletionConnectionString,
    ACCOUNT_DELETION_DATABASE_ENV,
  );
  if (decodeURIComponent(accountDeletion.username) !== ACCOUNT_DELETION_DATABASE_ROLE) {
    throw new Error(
      `${ACCOUNT_DELETION_DATABASE_ENV} must authenticate directly as ${ACCOUNT_DELETION_DATABASE_ROLE}`,
    );
  }
  if (!/-pooler\./i.test(accountDeletion.hostname)) {
    throw new Error(`${ACCOUNT_DELETION_DATABASE_ENV} must use a pooled endpoint`);
  }

  if (ordinaryConnectionString) {
    const ordinary = parsePostgresUrl(ordinaryConnectionString, "DATABASE_URL");
    if (decodeURIComponent(ordinary.username) === ACCOUNT_DELETION_DATABASE_ROLE) {
      throw new Error("DATABASE_URL must not authenticate as the account-deletion role");
    }
    if (
      accountDeletion.hostname.toLowerCase() !== ordinary.hostname.toLowerCase()
      || accountDeletion.port !== ordinary.port
      || accountDeletion.pathname !== ordinary.pathname
    ) {
      throw new Error(
        `${ACCOUNT_DELETION_DATABASE_ENV} must identify the same pooled database as DATABASE_URL`,
      );
    }
  }
  return accountDeletionConnectionString;
}

function requiredAccountDeletionDatabaseUrl() {
  const value = process.env[ACCOUNT_DELETION_DATABASE_ENV];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${ACCOUNT_DELETION_DATABASE_ENV} env var is required`);
  }
  return assertAccountDeletionDatabaseBoundary(value, process.env.DATABASE_URL);
}

function createAccountDeletionClient() {
  const adapter = new PrismaPg({
    ...runtimeDatabasePoolOptions(requiredAccountDeletionDatabaseUrl()),
    max: 2,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function getAccountDeletionSideEffectClient() {
  if (!globalForAccountDeletion.accountDeletionPrisma) {
    globalForAccountDeletion.accountDeletionPrisma = createAccountDeletionClient();
  }
  return globalForAccountDeletion.accountDeletionPrisma;
}
