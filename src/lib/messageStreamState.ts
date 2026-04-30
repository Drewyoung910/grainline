export function isTerminalMessageStreamStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

export function messageStreamStatusMessage(status: number): string {
  if (status === 401) return "Sign in again to keep this conversation live.";
  if (status === 403) return "This conversation is no longer available.";
  if (status === 429) return "Message updates are temporarily rate limited.";
  return "Live message updates are temporarily unavailable.";
}
