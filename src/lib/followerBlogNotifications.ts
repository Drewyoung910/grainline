import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { mapWithConcurrency } from "@/lib/concurrency";
import { userFollowerNotificationPage } from "@/lib/userFollowerAccess";
import { sellerPublicBlogAuthor } from "@/lib/sellerProfilePublicAccess";

const BLOG_FOLLOWER_FANOUT_PAGE_SIZE = 1000;

export async function fanOutBlogPostToFollowers({
  postId,
  sellerProfileId,
}: {
  postId: string;
  sellerProfileId: string;
}) {
  const publicPost = await prisma.blogPost.findFirst({
    where: {
      id: postId,
      sellerProfileId,
      authorType: "MAKER",
      status: "PUBLISHED",
      publishedAt: { not: null, lte: new Date() },
      authorAccountActive: true,
    },
    select: {
      id: true,
      slug: true,
      title: true,
    },
  });
  if (!publicPost) return;
  const seller = await sellerPublicBlogAuthor(sellerProfileId);
  if (!seller) return;

  const sellerUserId = seller.userId;
  const sellerDisplay = seller.displayName ?? "A maker you follow";
  let cursor: string | undefined;

  while (true) {
    const followers = await userFollowerNotificationPage(prisma, {
      sellerProfileId,
      afterFollowId: cursor,
      limit: BLOG_FOLLOWER_FANOUT_PAGE_SIZE,
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
    cursor = followers[followers.length - 1].followId;
  }
}
