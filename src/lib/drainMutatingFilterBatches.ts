export async function drainMutatingFilterBatches<T>({
  keyOf,
  loadBatch,
  mutate,
}: {
  keyOf: (row: T) => string;
  loadBatch: () => Promise<readonly T[]>;
  mutate: (row: T) => Promise<void>;
}) {
  const processedKeys = new Set<string>();

  for (;;) {
    const rows = await loadBatch();
    if (rows.length === 0) return;

    for (const row of rows) {
      const key = keyOf(row);
      if (processedKeys.has(key)) {
        throw new Error(
          `Mutating-filter batch drain made no progress for row ${key}.`,
        );
      }
      processedKeys.add(key);
      await mutate(row);
    }
  }
}
