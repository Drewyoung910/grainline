/**
 * Safely serialize a JSON-LD object for embedding in a <script> tag.
 * Standard JSON.stringify does NOT escape </  — a user-controlled string
 * like "</script><script>alert(1)</script>" would break out of the
 * JSON-LD script tag and execute arbitrary JS.
 *
 * This function replaces </ with <\/ which is valid JSON and prevents
 * the browser from interpreting it as a closing tag.
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}
