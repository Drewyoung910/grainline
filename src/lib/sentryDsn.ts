type SentryEnv = {
  [key: string]: string | undefined;
  SENTRY_DSN?: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
};

function requireProductionSentryDsn(value: string | undefined, label: string, nodeEnv: string | undefined) {
  const dsn = value?.trim() ?? "";
  if (nodeEnv === "production" && !dsn) {
    throw new Error(`${label} is required in production.`);
  }
  return dsn;
}

export function resolveServerSentryDsn(env: SentryEnv = process.env, nodeEnv = process.env.NODE_ENV) {
  return requireProductionSentryDsn(
    env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN,
    "SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN",
    nodeEnv,
  );
}

export function resolveClientSentryDsn(env: SentryEnv = process.env, nodeEnv = process.env.NODE_ENV) {
  return requireProductionSentryDsn(env.NEXT_PUBLIC_SENTRY_DSN, "NEXT_PUBLIC_SENTRY_DSN", nodeEnv);
}
