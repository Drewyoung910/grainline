export async function assertPublicMediaAvailable(publicUrl: string) {
  const delays = [0, 250, 750];
  let lastStatus: number | null = null;

  for (const delay of delays) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      let res = await fetch(publicUrl, {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.status === 405) {
        res = await fetch(publicUrl, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: { Range: "bytes=0-0" },
        });
      }
      lastStatus = res.status;
      if (res.ok) return;
    } catch {
      // Try again; public CDN availability can lag object writes very briefly.
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `Uploaded media is not publicly available${lastStatus ? ` (HTTP ${lastStatus})` : ""}. Check CLOUDFLARE_R2_PUBLIC_URL and bucket custom-domain settings.`
  );
}
