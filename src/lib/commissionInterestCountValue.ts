export function resolvedInterestedCount({
  interestedCount,
  _count,
}: {
  interestedCount?: number | bigint | null;
  _count?: { interests?: number | bigint | null } | null;
}) {
  return Number(_count?.interests ?? interestedCount ?? 0);
}
