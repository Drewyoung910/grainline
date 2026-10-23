export type SavedBlogPostExportRelation = Readonly<{
  blogPostId: string;
  createdAt: Date;
}>;

export type SavedBlogPostPublicExportTarget = Readonly<{
  id: string;
  title: string;
  slug: string;
}>;

export function buildOwnerSavedBlogPostExportRows(
  savedRows: readonly SavedBlogPostExportRelation[],
  publicTargets: readonly SavedBlogPostPublicExportTarget[],
) {
  const publicTargetById = new Map(
    publicTargets.map(({ id, title, slug }) => [id, { title, slug }]),
  );
  return savedRows.map((saved) => ({
    ...saved,
    blogPost: publicTargetById.get(saved.blogPostId) ?? null,
  }));
}
