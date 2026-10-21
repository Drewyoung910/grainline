export function accountDeletionBlogPostMediaOwnerWhere(
  userId: string,
  sellerProfileId: string | null,
) {
  return {
    OR: [
      { authorId: userId },
      ...(sellerProfileId ? [{ sellerProfileId }] : []),
    ],
  };
}
