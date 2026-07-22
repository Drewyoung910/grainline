import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { mapWithConcurrency } from "@/lib/concurrency";
import { publicBlogPostWhere } from "@/lib/blogVisibility";

const BLOG_FOLLOWER_FANOUT_PAGE_SIZE = 1000;

export async function fanOutBlogPostToFollowers({
  postId,
  sellerProfileId,
}: {
  postId: string;
  sellerProfileId: string;
}) {
  const publicPost = await prisma.blogPost.findFirst({
    where: publicBlogPostWhere({ id: postId, sellerProfileId }),
    select: {
      id: true,
      slug: true,
      title: true,
      sellerProfile: { select: { displayName: true, userId: true } },
    },
  });
  if (!publicPost?.sellerProfile?.userId) return;

  const sellerUserId = publicPost.sellerProfile.userId;
  const sellerDisplay = publicPost.sellerProfile.displayName ?? "A maker you follow";
  let cursor: string | undefined;

  while (true) {
    const followers = await prisma.follow.findMany({
      where: {
        sellerProfileId,
        followerId: { not: sellerUserId },
        follower: {
          banned: false,
          deletedAt: null,
          blocks: { none: { blockedId: sellerUserId } },
          blockedBy: { none: { blockerId: sellerUserId } },
        },
      },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, followerId: true },
      take: BLOG_FOLLOWER_FANOUT_PAGE_SIZE,
    });

    if (followers.length === 0) return;

    await mapWithConcurrency(followers, 10, (f) =>
      createNotification({
        userId: f.followerId,
        type: "FOLLOWED_MAKER_NEW_BLOG",
        title: `New post from ${sellerDisplay}`,
        body: publicPost.title,
        link: `/blog/${publicPost.slug}`,
        sourceType: NOTIFICATION_SOURCE_TYPES.FOLLOWED_MAKER_NEW_BLOG,
        sourceId: publicPost.id,
        relatedUserId: sellerUserId,
      }),
    );

    if (followers.length < BLOG_FOLLOWER_FANOUT_PAGE_SIZE) return;
    cursor = followers[followers.length - 1].id;
  }
}
