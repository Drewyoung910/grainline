import { createHash } from "crypto";

export function notificationDedupKey({
  userId,
  type,
  link,
  dedupScope,
  date = new Date(),
}: {
  userId: string;
  type: string;
  link?: string | null;
  dedupScope?: string | null;
  date?: Date;
}) {
  const bucket = date.toISOString().slice(0, 10);
  const parts = [bucket, userId, type, link ?? ""];
  if (dedupScope) parts.push(dedupScope);

  return createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex");
}
