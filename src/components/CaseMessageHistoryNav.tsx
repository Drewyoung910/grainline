import Link from "next/link";

export default function CaseMessageHistoryNav({
  baseHref,
  olderCursor,
  isHistoricalPage,
}: {
  baseHref: string;
  olderCursor: string | null;
  isHistoricalPage: boolean;
}) {
  if (!olderCursor && !isHistoricalPage) return null;

  return (
    <nav
      aria-label="Case message history"
      className="flex flex-wrap items-center gap-2 border-t border-neutral-100 bg-neutral-50 px-4 py-3"
    >
      {isHistoricalPage ? (
        <Link
          href={baseHref}
          className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Back to latest
        </Link>
      ) : null}
      {olderCursor ? (
        <Link
          href={`${baseHref}?caseBefore=${encodeURIComponent(olderCursor)}`}
          className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          View older messages
        </Link>
      ) : null}
    </nav>
  );
}
