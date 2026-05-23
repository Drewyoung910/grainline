import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { isR2PublicUrl } from "./urlValidation.ts";
import { truncateText } from "./sanitize.ts";

export const MAX_RENDERED_BLOG_MARKDOWN_CHARS = 200_000;

type SanitizerFrame = {
  tag: string;
  attribs?: Record<string, string | undefined>;
};

export function renderBlogMarkdown(body: string): string {
  const rawHtml = marked.parse(truncateText(body, MAX_RENDERED_BLOG_MARKDOWN_CHARS)) as string;

  return sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img", "h1", "h2", "h3", "h4", "h5", "h6",
      "hr", "del", "sup", "sub", "table", "thead",
      "tbody", "tr", "th", "td", "pre", "code",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "width", "height"],
      a: ["href", "title"],
      code: ["class"],
      pre: ["class"],
    },
    allowedSchemes: ["https", "mailto"],
    exclusiveFilter(frame: SanitizerFrame) {
      if (frame.tag !== "img") return false;
      const src = frame.attribs?.src ?? "";
      return !isR2PublicUrl(src);
    },
  });
}
