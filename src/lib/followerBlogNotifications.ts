import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { mapWithConcurrency } from "@/lib/concurrency";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { userFollowerNotificationPage } from "@/lib/userFollowerAccess";

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
