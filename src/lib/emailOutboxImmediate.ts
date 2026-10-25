export type NewlyEnqueuedEmailOutboxJob = {
  job: { id: string } | null;
  created: boolean;
};

/**
 * Gives only a newly-created durable row one prompt delivery attempt. Exact
 * producer replays leave an existing row to its active claim or the scheduled
 * recovery worker, so they cannot create a second provider attempt.
 */
export async function processNewlyEnqueuedEmailOutboxJob<TResult>(
  enqueued: NewlyEnqueuedEmailOutboxJob,
  processJob: (id: string) => Promise<TResult>,
): Promise<TResult | null> {
  if (!enqueued.job || !enqueued.created) return null;
  return processJob(enqueued.job.id);
}
