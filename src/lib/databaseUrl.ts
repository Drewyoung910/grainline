const SSL_MODES_TO_PIN = new Set(["prefer", "require", "verify-ca"]);

export function normalizeRuntimeDatabaseUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get("sslmode");
    if (sslMode && SSL_MODES_TO_PIN.has(sslMode.toLowerCase())) {
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
  } catch {
    return connectionString;
  }
  return connectionString;
}
