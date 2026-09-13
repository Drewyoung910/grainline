const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const VIMEO_ID_RE = /^\d+$/;
const YOUTUBE_ALLOWED_QUERY = new Set(["t", "start", "end"]);

export function normalizeBlogVideoUrlString(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Video URL must be a valid URL.");
  }

  const normalized = normalizeYouTubeUrl(parsed) ?? normalizeVimeoUrl(parsed);
  if (!normalized) {
    throw new Error("Video URL must be a valid YouTube or Vimeo video URL.");
  }

  return normalized;
}

export function extractBlogVideoEmbed(url: string): { type: "youtube" | "vimeo"; id: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return extractYouTubeEmbed(parsed) ?? extractVimeoEmbed(parsed);
}

function normalizeYouTubeUrl(parsed: URL): string | null {
  const embed = extractYouTubeEmbed(parsed);
  if (!embed) return null;

  const host = normalizedHost(parsed);
  const out =
    host === "youtu.be"
      ? new URL(`https://youtu.be/${embed.id}`)
      : parsed.pathname.startsWith("/shorts/")
        ? new URL(`https://www.youtube.com/shorts/${embed.id}`)
        : parsed.pathname.startsWith("/embed/")
          ? new URL(`https://www.youtube-nocookie.com/embed/${embed.id}`)
          : new URL("https://www.youtube.com/watch");

  if (out.pathname === "/watch") {
    out.searchParams.set("v", embed.id);
  }
  copyAllowedQueryParams(parsed.searchParams, out.searchParams, YOUTUBE_ALLOWED_QUERY);
  return out.toString();
}

function normalizeVimeoUrl(parsed: URL): string | null {
  const embed = extractVimeoEmbed(parsed);
  if (!embed) return null;
  return `https://vimeo.com/${embed.id}`;
}

function extractYouTubeEmbed(parsed: URL): { type: "youtube"; id: string } | null {
  const host = normalizedHost(parsed);
  if (parsed.protocol !== "https:") return null;

  let id: string | null = null;
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname === "/watch") {
      id = parsed.searchParams.get("v");
    } else if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/shorts/")) {
      id = firstPathSegmentAfterPrefix(parsed.pathname, parsed.pathname.startsWith("/embed/") ? "/embed/" : "/shorts/");
    }
  } else if (host === "youtube-nocookie.com") {
    if (parsed.pathname.startsWith("/embed/")) {
      id = firstPathSegmentAfterPrefix(parsed.pathname, "/embed/");
    }
  } else if (host === "youtu.be") {
    id = firstPathSegmentAfterPrefix(parsed.pathname, "/");
  }

  if (!id || !YOUTUBE_ID_RE.test(id)) return null;
  return { type: "youtube", id };
}

function extractVimeoEmbed(parsed: URL): { type: "vimeo"; id: string } | null {
  const host = normalizedHost(parsed);
  if (parsed.protocol !== "https:") return null;

  let id: string | null = null;
  if (host === "vimeo.com") {
    id = firstPathSegmentAfterPrefix(parsed.pathname, "/");
  } else if (host === "player.vimeo.com" && parsed.pathname.startsWith("/video/")) {
    id = firstPathSegmentAfterPrefix(parsed.pathname, "/video/");
  }

  if (!id || !VIMEO_ID_RE.test(id)) return null;
  return { type: "vimeo", id };
}

function normalizedHost(parsed: URL) {
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

function firstPathSegmentAfterPrefix(pathname: string, prefix: string) {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  if (!rest || rest.includes("/")) return null;
  return rest;
}

function copyAllowedQueryParams(
  input: URLSearchParams,
  output: URLSearchParams,
  allowed: Set<string>,
) {
  for (const [key, value] of input) {
    if (!allowed.has(key)) continue;
    output.set(key, value);
  }
}
