export type CaseMessageAuthorKindValue = "BUYER" | "SELLER" | "STAFF";

type CaseMessageActor = {
  actorId: string;
  buyerId: string | null;
  sellerId: string;
  isStaff: boolean;
};

export function caseMessageAuthorKindForActor({
  actorId,
  buyerId,
  sellerId,
  isStaff,
}: CaseMessageActor): CaseMessageAuthorKindValue {
  if (buyerId && actorId === buyerId) return "BUYER";
  if (actorId === sellerId) return "SELLER";
  if (isStaff) return "STAFF";
  throw new Error("CASE_MESSAGE_AUTHOR_UNAVAILABLE");
}

export function caseMessageAuthorLabel({
  authorKind,
  authorId,
  buyerId,
  sellerId,
  viewerId,
  legacyAuthorRole,
}: {
  authorKind: CaseMessageAuthorKindValue | null;
  authorId: string;
  buyerId: string | null;
  sellerId: string;
  viewerId?: string;
  legacyAuthorRole?: string;
}): string {
  const durableKind =
    authorKind ??
    (authorId === buyerId
      ? "BUYER"
      : authorId === sellerId
        ? "SELLER"
        : legacyAuthorRole === "EMPLOYEE" || legacyAuthorRole === "ADMIN"
          ? "STAFF"
          : null);

  if (durableKind === "STAFF") return "Grainline Staff";
  if (durableKind === "BUYER") return viewerId === authorId ? "You (Buyer)" : "Buyer";
  if (durableKind === "SELLER") return viewerId === authorId ? "You (Seller)" : "Seller";
  return "Participant";
}
