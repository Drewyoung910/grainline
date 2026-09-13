export function blockedUserIdsFromRows({
  blockedByMe,
  blockingMe,
}: {
  blockedByMe: Array<{ blockedId: string }>;
  blockingMe: Array<{ blockerId: string }>;
}): Set<string> {
  const ids = new Set<string>();
  for (const block of blockedByMe) ids.add(block.blockedId);
  for (const block of blockingMe) ids.add(block.blockerId);
  return ids;
}

export function sellerProfileIdsFromRows(sellers: Array<{ id: string }>): string[] {
  return sellers.map((s) => s.id);
}
