const MAX_KEY_SEGMENT_LENGTH = 128;

export function uploadKeyUserSegment(userId: string): string {
  const segment = userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, MAX_KEY_SEGMENT_LENGTH);
  return segment || "user";
}
