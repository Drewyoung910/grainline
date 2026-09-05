import "server-only";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runtimeDatabasePoolOptions } from "@/lib/databaseUrl";

export const ORDER_STAFF_READ_DATABASE_ENV = "ORDER_STAFF_READ_DATABASE_URL";
export const ORDER_STAFF_READ_DATABASE_ROLE = "grainline_staff_read_runtime";

const globalForOrderStaffRead = globalThis as unknown as {
  orderStaffReadPrisma?: PrismaClient;
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

export function assertOrderStaffReadDatabaseBoundary(
  staffConnectionString: string,
  ordinaryConnectionString?: string,
) {
  const staff = parsePostgresUrl(
    staffConnectionString,
    ORDER_STAFF_READ_DATABASE_ENV,
  );
  if (decodeURIComponent(staff.username) !== ORDER_STAFF_READ_DATABASE_ROLE) {
    throw new Error(
      `${ORDER_STAFF_READ_DATABASE_ENV} must authenticate directly as ${ORDER_STAFF_READ_DATABASE_ROLE}`,
    );
  }
  if (!/-pooler\./i.test(staff.hostname)) {
    throw new Error(`${ORDER_STAFF_READ_DATABASE_ENV} must use a pooled endpoint`);
  }

  if (ordinaryConnectionString) {
    const ordinary = parsePostgresUrl(ordinaryConnectionString, "DATABASE_URL");
    if (decodeURIComponent(ordinary.username) === ORDER_STAFF_READ_DATABASE_ROLE) {
      throw new Error("DATABASE_URL must not authenticate as the staff read role");
    }
    if (
      staff.hostname.toLowerCase() !== ordinary.hostname.toLowerCase()
      || staff.port !== ordinary.port
      || staff.pathname !== ordinary.pathname
    ) {
      throw new Error(
        `${ORDER_STAFF_READ_DATABASE_ENV} must identify the same pooled database as DATABASE_URL`,
      );
    }
  }
  return staffConnectionString;
}

function requiredOrderStaffReadDatabaseUrl() {
  const value = process.env[ORDER_STAFF_READ_DATABASE_ENV];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${ORDER_STAFF_READ_DATABASE_ENV} env var is required`);
  }
  return assertOrderStaffReadDatabaseBoundary(value, process.env.DATABASE_URL);
}

function createOrderStaffReadClient() {
  const adapter = new PrismaPg({
    ...runtimeDatabasePoolOptions(requiredOrderStaffReadDatabaseUrl()),
    // Staff reads are low-volume and must not consume the ordinary runtime's
    // independently reviewed ten-connection budget.
    max: 2,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function getOrderStaffReadClient() {
  if (!globalForOrderStaffRead.orderStaffReadPrisma) {
    globalForOrderStaffRead.orderStaffReadPrisma = createOrderStaffReadClient();
  }
  return globalForOrderStaffRead.orderStaffReadPrisma;
}
