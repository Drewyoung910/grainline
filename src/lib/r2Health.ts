type Status = "ok" | "fail";

export async function probeR2Health({
  publicBucket,
  privateBucket,
  headBucket,
}: {
  publicBucket: string;
  privateBucket: string | null | undefined;
  headBucket: (bucket: string) => Promise<unknown>;
}): Promise<Record<string, Status>> {
  const probe = async (bucket: string): Promise<Status> => {
    try {
      if (!bucket || bucket.trim() !== bucket) return "fail";
      await headBucket(bucket);
      return "ok";
    } catch {
      return "fail";
    }
  };
  const privateConfigured = Boolean(privateBucket);
  const [publicStatus, privateStatus] = await Promise.all([
    probe(publicBucket),
    privateConfigured
      ? privateBucket === publicBucket
        ? Promise.resolve<Status>("fail")
        : probe(privateBucket!)
      : Promise.resolve<Status>("ok"),
  ]);
  return {
    r2: publicStatus,
    ...(privateConfigured ? { r2Private: privateStatus } : {}),
  };
}
