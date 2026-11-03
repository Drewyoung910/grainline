import { parseFileMessageBody } from "./messageBodies.ts";

function isImageUrl(s: string) {
  return /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif)$/i.test(s.trim());
}
function isPdfUrl(s: string) {
  return /^https?:\/\/.+\.pdf$/i.test(s.trim());
}

export function formatSnippet(body?: string | null, kind?: string | null) {
  const txt = (body ?? "").toString();
  if (!txt) return "No messages yet";

  const f = parseFileMessageBody(txt.trim());
  if (f) {
    const isImg = (f.type?.startsWith("image/") ?? false) || isImageUrl(f.url);
    if (isImg) return "Photo";
    if (f.type === "application/pdf" || isPdfUrl(f.url)) return f.name ?? "PDF";
    return f.name ?? "Attachment";
  }

  if (kind === "commission_interest_card") return "Interested in your commission";
  if (kind === "custom_order_request") return "Custom order request";
  if (kind === "custom_order_link") return "Custom listing ready";

  if (isImageUrl(txt)) return "Photo";
  if (isPdfUrl(txt)) return "PDF";
  return txt;
}
