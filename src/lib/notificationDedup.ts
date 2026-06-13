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
  const parts = dedupScope
    ? [userId, type, link ?? "", dedupScope]
    : [date.toISOString().slice(0, 10), userId, type, link ?? ""];

  return createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex");
}
