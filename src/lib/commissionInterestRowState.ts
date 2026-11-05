// A maker who has already spoken to this buyer reuses their conversation, so the
// returned conversation id legitimately differs from the proposed one even when a
// new interest was created. Only the interest and its card must be the proposed ids.
export function commissionInterestCreatedIdsMatch(
  row: { created: boolean; messageId: string; commissionInterestId: string },
  proposed: { messageId: string; commissionInterestId: string },
) {
  return !row.created || (
    row.messageId === proposed.messageId
    && row.commissionInterestId === proposed.commissionInterestId
  );
}
