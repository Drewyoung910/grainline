const SSL_MODES_TO_PIN = new Set(["prefer", "require", "verify-ca"]);

export function normalizeRuntimeDatabaseUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get("sslmode");
    if (!sslMode) {
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
    if (sslMode && SSL_MODES_TO_PIN.has(sslMode.toLowerCase())) {
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
  } catch {
    return connectionString;
  }
  return connectionString;
}

export function runtimeDatabasePoolOptions(connectionString: string): {
  connectionString: string;
  enableChannelBinding?: true;
} {
  const normalizedConnectionString = normalizeRuntimeDatabaseUrl(connectionString);
  try {
    const url = new URL(normalizedConnectionString);
    if (url.searchParams.get("channel_binding") === "require") {
      return {
        connectionString: normalizedConnectionString,
        enableChannelBinding: true,
      };
    }
  } catch {
    // Preserve the existing invalid-URL behavior: the database driver reports
    // the connection failure without this helper masking or rewriting it.
  }
  return { connectionString: normalizedConnectionString };
}
