export function requiredProductionEnv(name: string): string {
  const value = process.env[name];
  if (typeof value === "string" && value.trim().length > 0) return value;

  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error(`${name} env var is required in production.`);
  }

  return "";
}
