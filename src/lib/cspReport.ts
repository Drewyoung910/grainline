type CspReportValue = string | number | boolean | null | undefined;

export type CspReportLike = Record<string, CspReportValue>;

const MAX_TAG_VALUE_LENGTH = 180;

function field(report: CspReportLike, key: string): string {
  const value = report[key];
  return typeof value === "string" ? value : "";
}

function truncateTag(value: string): string {
  return value.length > MAX_TAG_VALUE_LENGTH ? `${value.slice(0, MAX_TAG_VALUE_LENGTH - 1)}…` : value;
}

function originOrKeyword(value: string): string {
  if (!value) return "unknown";
  if (!value.includes(":")) return truncateTag(value);
  try {
    return new URL(value).origin;
  } catch {
    return truncateTag(value);
  }
}

function originAndPath(value: string): string {
  if (!value) return "unknown";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname || "/"}`;
  } catch {
    if (value.startsWith("/")) return value.split("?")[0] || "/";
    return originOrKeyword(value);
  }
}

export function cspReportDirective(report: CspReportLike): string {
  return field(report, "effective-directive") || field(report, "violated-directive") || "unknown";
}

export function cspReportDocumentPath(report: CspReportLike): string {
  const documentUri = field(report, "document-uri");
  if (!documentUri) return "unknown";
  try {
    return new URL(documentUri).pathname || "/";
  } catch {
    if (documentUri.startsWith("/")) return documentUri.split("?")[0] || "/";
    return "unknown";
  }
}

export function isCheckoutCspReport(report: CspReportLike): boolean {
  const path = cspReportDocumentPath(report);
  return path === "/cart" || path.startsWith("/checkout");
}

export function sanitizeCspReportForSentry(report: CspReportLike): CspReportLike {
  const sanitized: CspReportLike = {};
  for (const [key, value] of Object.entries(report)) {
    if (typeof value !== "string") {
      sanitized[key] = value;
      continue;
    }
    if (key === "document-uri" || key === "referrer") {
      sanitized[key] = originAndPath(value);
      continue;
    }
    if (key === "blocked-uri" || key === "source-file") {
      sanitized[key] = originOrKeyword(value);
      continue;
    }
    sanitized[key] = value.length > 500 ? `${value.slice(0, 499)}…` : value;
  }
  return sanitized;
}

export function cspReportBreadcrumbData(report: CspReportLike): Record<string, CspReportValue> {
  const sanitized = sanitizeCspReportForSentry(report);
  return {
    blockedUri: sanitized["blocked-uri"],
    violatedDirective: sanitized["violated-directive"],
    documentPath: cspReportDocumentPath(report),
    effectiveDirective: sanitized["effective-directive"],
    checkoutSurface: isCheckoutCspReport(report) ? "true" : "false",
  };
}

export function cspReportSentryTags(report: CspReportLike): Record<string, string> {
  const directive = cspReportDirective(report);
  return {
    source: "csp_report",
    event_kind: "security_policy",
    csp_violation: truncateTag(directive),
    blocked_uri: originOrKeyword(field(report, "blocked-uri")),
    document_path: truncateTag(cspReportDocumentPath(report)),
    checkout_surface: isCheckoutCspReport(report) ? "true" : "false",
  };
}
