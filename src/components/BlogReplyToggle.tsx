"use client";
import * as React from "react";
import BlogCommentForm from "./BlogCommentForm";

interface Reply {
  id: string;
  body: string;
  createdAt: Date | string;
  author: { id: string; name: string | null; imageUrl: string | null };
}

export default function BlogReplyToggle({
  slug,
  parentId,
  replies,
  isSignedIn,
}: {
  slug: string;
  parentId: string;
  replies: Reply[];
  isSignedIn: boolean;
}) {
  const [showing, setShowing] = React.useState(false);

  if (replies.length === 0 && !isSignedIn) return null;

  return (
    <div className="pl-8 border-l border-neutral-100 mt-3 space-y-3">
      {replies.map((r) => (
        <div key={r.id} className="flex gap-3">
          {r.author.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.author.imageUrl}
              alt={r.author.name ?? ""}
              className="h-7 w-7 rounded-full object-cover shrink-0 mt-0.5"
            />
          ) : (
            <div className="h-7 w-7 rounded-full bg-neutral-200 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{r.author.name ?? "User"}</span>
              <span className="text-xs text-neutral-400">
                {new Date(r.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
            <p className="text-sm text-neutral-700 mt-0.5 whitespace-pre-wrap">{r.body}</p>
          </div>
        </div>
      ))}

      {isSignedIn && (
        showing ? (
          <BlogCommentForm
            slug={slug}
            parentId={parentId}
            placeholder="Write a reply…"
            onCancel={() => setShowing(false)}
          />
        ) : (
          <button
            onClick={() => setShowing(true)}
            className="text-xs text-neutral-500 hover:text-neutral-700 hover:underline"
          >
            Reply
          </button>
        )
      )}
    </div>
  );
}
