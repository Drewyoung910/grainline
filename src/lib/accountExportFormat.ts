export function accountExportFilename(userId: string, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  return `grainline-account-export-${userId}-${date}.json`;
}

export function accountExportHeaders(userId: string, now = new Date()) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${accountExportFilename(userId, now)}"`,
    "Cache-Control": "no-store",
  };
}

export function accountExportJsonResponse(data: unknown, userId: string, now = new Date()) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: accountExportHeaders(userId, now),
  });
}
