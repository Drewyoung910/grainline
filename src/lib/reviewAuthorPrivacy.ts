/** What other shoppers see for a reviewer: first name and last initial, never the full account name. */
export function publicReviewerName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part.includes("@"))) return "Buyer";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${Array.from(parts[parts.length - 1])[0]}.`;
}
