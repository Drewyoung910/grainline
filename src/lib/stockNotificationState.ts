export function stockNotificationSubscribedFromResponse(value: unknown, fallback: boolean): boolean {
  if (!value || typeof value !== "object") return fallback;
  const subscribed = (value as { subscribed?: unknown }).subscribed;
  return typeof subscribed === "boolean" ? subscribed : fallback;
}
