export type StaffThreadReviewParticipant = {
  id: string;
  authorLabel: string;
  imageUrl: string | null;
  align: "left" | "right";
};

export type StaffThreadMessagePresentation = {
  authorLabel: string;
  imageUrl: string | null;
  alignRight: boolean;
};

export function staffThreadMessagePresentation(
  senderId: string,
  participants: readonly StaffThreadReviewParticipant[] | undefined,
): StaffThreadMessagePresentation | null {
  if (!participants) return null;

  const participant = participants.find((candidate) => candidate.id === senderId);
  if (!participant) {
    return {
      authorLabel: "Unknown participant",
      imageUrl: null,
      alignRight: false,
    };
  }

  return {
    authorLabel: participant.authorLabel,
    imageUrl: participant.imageUrl,
    alignRight: participant.align === "right",
  };
}
