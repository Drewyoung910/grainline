import * as Sentry from "@sentry/nextjs";
import { sanitizeEmailOutboxError } from "./emailOutboxSanitize.ts";

type TelemetryPrimitive = string | number | boolean | null | undefined;
type ServerErrorLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

export type ServerErrorLogContext = {
  source: string;
  level?: ServerErrorLevel;
  tags?: Record<string, TelemetryPrimitive>;
  extra?: Record<string, TelemetryPrimitive>;
};

const MAX_CONTEXT_VALUE_LENGTH = 200;

function sanitizeContextValue(value: TelemetryPrimitive): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return sanitizeEmailOutboxError(value).slice(0, MAX_CONTEXT_VALUE_LENGTH);
}

function sanitizeContextRecord(record: Record<string, TelemetryPrimitive> | undefined) {
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, sanitizeContextValue(value)]),
  );
}

export function sanitizeServerErrorMessage(error: unknown) {
  return sanitizeEmailOutboxError(error);
}

export function sanitizeServerErrorTags(tags: Record<string, TelemetryPrimitive> | undefined) {
  const sanitized = sanitizeContextRecord(tags);
  if (!sanitized) return undefined;
  return Object.fromEntries(
    Object.entries(sanitized).map(([key, value]) => [key, String(value ?? "null")]),
  );
}

export function sanitizeServerErrorExtra(extra: Record<string, TelemetryPrimitive> | undefined) {
  return sanitizeContextRecord(extra);
}

function sentryErrorFrom(error: unknown, sanitizedMessage: string) {
  const sentryError = new Error(sanitizedMessage || "Unknown server error");
  if (error instanceof Error) {
    sentryError.name = error.name;
    sentryError.stack = error.stack ? sanitizeEmailOutboxError(error.stack) : sentryError.stack;
  }
  return sentryError;
}

export function logServerError(error: unknown, context: ServerErrorLogContext) {
  const sanitizedMessage = sanitizeServerErrorMessage(error);
  console.error(`[${context.source}]`, sanitizedMessage);
  Sentry.captureException(sentryErrorFrom(error, sanitizedMessage), {
    level: context.level,
    tags: {
      source: context.source,
      ...sanitizeServerErrorTags(context.tags),
    },
    extra: {
      sanitizedMessage,
      ...sanitizeServerErrorExtra(context.extra),
    },
  });
}
