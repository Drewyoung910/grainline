export function isInAppNotificationEnabled(
  preferences: Record<string, boolean> | null | undefined,
  type: string,
): boolean {
  return preferences?.[type] !== false;
}
