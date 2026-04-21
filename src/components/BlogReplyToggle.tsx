"use client";
import * as React from "react";
import BlogCommentForm from "./BlogCommentForm";
import BlockReportButton from "./BlockReportButton";

interface Level3Reply {
  id: string;
  body: string;
  createdAt: Date | string;
  author: {
    id: string;
    name: string | null;
    imageUrl: string | null;
    sellerProfile?: { avatarImageUrl: string | null } | null;
  };
}

interface Reply {
  id: string;
  body: string;
  createdAt: Date | string;
  author: {
    id: string;
    name: string | null;
    imageUrl: string | null;
    sellerProfile?: { avatarImageUrl: string | null } | null;
  };
  replies?: Level3Reply[];
}

export default function BlogReplyToggle({
  slug,
  parentId,
  replies,
  isSignedIn,
  meId,
}: {
  slug: string;
  parentId: string;
  replies: Reply[];
  isSignedIn: boolean;
  meId?: string | null;
}) {
  // Toggle state for adding a level-2 reply to this level-1 comment
  const [showingRoot, setShowingRoot] = React.useState(false);
  // Toggle state per level-2 reply id (for adding level-3 replies)
  const [showingReplyId, setShowingReplyId] = React.useState<string | null>(null);

  if (replies.length === 0 && !isSignedIn) return null;

  return (
    <div className="pl-8 border-l border-neutral-300 mt-3 space-y-3">
      {/* Level-2 replies */}
      {replies.map((r) => {
        const rAvatarUrl = r.author.sellerProfile?.avatarImageUrl ?? r.author.imageUrl;
        return (
          <div key={r.id} className="space-y-2">
            {/* Level-2 reply content */}
            <div className="flex gap-3">
              {rAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={rAvatarUrl}
                  alt={r.author.name ?? ""}
                  className="h-7 w-7 rounded-full object-cover shrink-0 mt-0.5"
                />
              ) : (
                <div className="h-7 w-7 rounded-full bg-neutral-200 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{r.author.name ?? "User"}</span>
                  <span className="text-xs text-neutral-400">
                    {new Date(r.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  {meId && meId !== r.author.id && (
                    <span className="ml-auto">
                      <BlockReportButton
                        targetUserId={r.author.id}
                        targetName={r.author.name ?? "this user"}
                        targetType="BLOG_COMMENT"
                        targetId={r.id}
                      />
                    </span>
                  )}
                </div>
                <p className="text-sm text-neutral-700 mt-0.5 whitespace-pre-wrap">{r.body}</p>
              </div>
            </div>

            {/* Level-3 replies (no Reply button) */}
            {r.replies && r.replies.length > 0 && (
              <div className="pl-10 border-l border-neutral-300 space-y-2">
                {r.replies.map((r3) => {
                  const r3AvatarUrl = r3.author.sellerProfile?.avatarImageUrl ?? r3.author.imageUrl;
                  return (
                    <div key={r3.id} className="flex gap-3">
                      {r3AvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r3AvatarUrl}
                          alt={r3.author.name ?? ""}
                          className="h-6 w-6 rounded-full object-cover shrink-0 mt-0.5"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-neutral-200 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{r3.author.name ?? "User"}</span>
                          <span className="text-xs text-neutral-400">
                            {new Date(r3.createdAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                          {meId && meId !== r3.author.id && (
                            <span className="ml-auto">
                              <BlockReportButton
                                targetUserId={r3.author.id}
                                targetName={r3.author.name ?? "this user"}
                                targetType="BLOG_COMMENT"
                                targetId={r3.id}
                              />
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-neutral-700 mt-0.5 whitespace-pre-wrap">{r3.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Reply button for level-2 (creates level-3) */}
            {isSignedIn && (
              showingReplyId === r.id ? (
                <BlogCommentForm
                  slug={slug}
                  parentId={r.id}
                  placeholder="Write a reply…"
                  onCancel={() => setShowingReplyId(null)}
                />
              ) : (
                <button
                  onClick={() => setShowingReplyId(r.id)}
                  className="text-xs text-neutral-500 hover:text-neutral-700 hover:underline pl-10"
                >
                  Reply
                </button>
              )
            )}
          </div>
        );
      })}

      {/* Reply button for level-1 (creates level-2) */}
      {isSignedIn && (
        showingRoot ? (
          <BlogCommentForm
            slug={slug}
            parentId={parentId}
            placeholder="Write a reply…"
            onCancel={() => setShowingRoot(false)}
          />
        ) : (
          <button
            onClick={() => setShowingRoot(true)}
            className="text-xs text-neutral-500 hover:text-neutral-700 hover:underline"
          >
            Reply
          </button>
        )
      )}
    </div>
  );
}
