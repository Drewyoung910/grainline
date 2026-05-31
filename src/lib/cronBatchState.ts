export type CronCursorPageResult = {
  pagesFetched: number;
  itemsSeen: number;
};

export async function runCronCursorPages<T>({
  pageSize,
  fetchPage,
  getCursor,
  processPage,
}: {
  pageSize: number;
  fetchPage: (cursorId: string | null) => Promise<T[]>;
  getCursor: (item: T) => string | null | undefined;
  processPage: (items: T[]) => Promise<void> | void;
}): Promise<CronCursorPageResult> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("Cron cursor page size must be a positive integer.");
  }

  let cursorId: string | null = null;
  let pagesFetched = 0;
  let itemsSeen = 0;

  while (true) {
    const page = await fetchPage(cursorId);
    pagesFetched += 1;
    if (page.length === 0) break;

    await processPage(page);
    itemsSeen += page.length;

    const nextCursor = getCursor(page[page.length - 1]);
    if (!nextCursor || page.length < pageSize) break;
    cursorId = nextCursor;
  }

  return { pagesFetched, itemsSeen };
}

export async function runBoundedDeletionBatches({
  batchSize,
  timeBudgetMs,
  deleteBatch,
  now = Date.now,
}: {
  batchSize: number;
  timeBudgetMs: number;
  deleteBatch: () => Promise<number> | number;
  now?: () => number;
}): Promise<{ count: number; complete: boolean }> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("Cron deletion batch size must be a positive integer.");
  }
  if (!Number.isFinite(timeBudgetMs) || timeBudgetMs < 0) {
    throw new Error("Cron deletion time budget must be a non-negative number.");
  }

  const deadline = now() + timeBudgetMs;
  let totalDeleted = 0;

  while (now() < deadline) {
    const deleted = Number(await deleteBatch());
    const count = Number.isFinite(deleted) ? deleted : 0;
    totalDeleted += count;
    if (count === 0 || count < batchSize) {
      return { count: totalDeleted, complete: true };
    }
  }

  return { count: totalDeleted, complete: false };
}
