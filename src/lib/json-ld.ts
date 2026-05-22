/**
 * Safely serialize a JSON-LD object for embedding in a <script> tag.
 * Standard JSON.stringify does NOT escape </  — a user-controlled string
 * like "</script><script>alert(1)</script>" would break out of the
 * JSON-LD script tag and execute arbitrary JS.
 *
 * This function escapes `<` plus invisible directional/line separator controls
 * so the browser cannot interpret a closing tag and reviewers don't have to
 * inspect ambiguous bidi text inside structured-data payloads.
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/[\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, (char) =>
      `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}
