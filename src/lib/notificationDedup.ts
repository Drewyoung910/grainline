import { createHash } from "crypto";

export function notificationDedupKey({
  userId,
  type,
  link,
  date = new Date(),
}: {
  userId: string;
  type: string;
  link?: string | null;
  date?: Date;
}) {
  const bucket = date.toISOString().slice(0, 10);
  return createHash("sha256")
    .update([bucket, userId, type, link ?? ""].join("\u001f"))
    .digest("hex");
}
