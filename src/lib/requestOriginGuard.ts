export type CrossOriginPostRejection = {
  header: "origin" | "referer" | "sec-fetch-site";
  value: string;
  expectedOrigin: string;
};

function requestOrigin(req: Request): string {
  return new URL(req.url).origin;
}

function headerOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getExplicitCrossOriginPostRejection(req: Request): CrossOriginPostRejection | null {
  const expectedOrigin = requestOrigin(req);
  const originHeader = req.headers.get("origin");
  const refererHeader = req.headers.get("referer");
  const fetchSiteHeader = req.headers.get("sec-fetch-site")?.toLowerCase() ?? null;

  if (originHeader && originHeader !== expectedOrigin) {
    return { header: "origin", value: originHeader, expectedOrigin };
  }

  if (refererHeader) {
    const refererOrigin = headerOrigin(refererHeader);
    if (refererOrigin !== expectedOrigin) {
      return { header: "referer", value: refererHeader, expectedOrigin };
    }
  }

  if (fetchSiteHeader && fetchSiteHeader !== "same-origin" && fetchSiteHeader !== "same-site" && fetchSiteHeader !== "none") {
    return { header: "sec-fetch-site", value: fetchSiteHeader, expectedOrigin };
  }

  return null;
}
