import { normalizeUserText, sanitizeText, truncateText } from "./sanitize.ts";

const PROMPT_CONTROL_PHRASES =
  /(?:\b(ignore|disregard|forget|override|bypass|skip|ignora|ignorar|ignorez|ignorer|oublie|oublier|oubliez|omite|omitir|anula|anular|descarta|descartar|desconsidera|desconsiderar|ignoriere|ignorieren|vergiss|vergesse)\b|忽略|忘记|忘記|無視|忘れて|무시|잊어|игнорируй|забудь|تجاهل|انس|अनदेखा)/giu;
const MODEL_CONTROL_MARKERS =
  /(<\|im_(?:start|end)\|>|\[\/?INST\]|\b(system|assistant|developer|user|human)\s*:)/giu;

export function redactPromptInjection(value: string): string {
  const redacted = normalizeUserText(value)
    .replace(PROMPT_CONTROL_PHRASES, "[redacted-command]")
    .replace(MODEL_CONTROL_MARKERS, "[redacted-role]:")
    .replace(/\b(approved|confidence|flags)\s*[:=]/gi, "[redacted-field]=")
    .replace(/```/g, "`\u200b``");
  return truncateText(redacted, 4000);
}

export function filterAIReviewImageUrls(
  urls: string[] | undefined,
  isAllowedUrl: (url: string) => boolean,
): string[] {
  // Cap matches the per-listing photo limit in `uploadRules.ts`
  // (`listingImage` UPLOAD_MAX_COUNTS = 10). Bumped 8 → 10 when the
  // photo cap was raised so AI review sees every photo and generates
  // alt text for the full set.
  return (urls ?? []).filter((url) => isAllowedUrl(url)).slice(0, 10);
}

export function normalizeDuplicateListingTitle(title: string) {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "").trim();
}

export function sanitizeAIAltText(value: string): string {
  const sanitized = sanitizeText(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateText(sanitized, 200);
}
