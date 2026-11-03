export type GrainlineImageRemotePattern = {
  protocol: "https";
  hostname: string;
  port: string;
  pathname: string;
  search: string;
};

export function imageRemotePatternsFromValues(
  values: Array<string | undefined>,
): GrainlineImageRemotePattern[] {
  const patterns = new Map<string, GrainlineImageRemotePattern>();

  for (const value of values.filter(Boolean)) {
    for (const part of value!.split(",")) {
      try {
        const url = new URL(part.trim());
        if (url.protocol !== "https:") continue;
        const basePath = url.pathname.replace(/\/$/, "");
        const pathname = basePath ? `${basePath}/**` : "/**";
        const key = `${url.hostname}:${url.port}:${pathname}`;
        patterns.set(key, {
          protocol: "https",
          hostname: url.hostname,
          port: url.port,
          pathname,
          search: "",
        });
      } catch {
        // Ignore malformed optional environment values.
      }
    }
  }

  return [...patterns.values()];
}
