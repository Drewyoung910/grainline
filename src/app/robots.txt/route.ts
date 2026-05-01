// src/app/robots.txt/route.ts
import { NextResponse } from "next/server";

export function GET() {
  const body = `User-agent: *
Allow: /
Crawl-delay: 10
Disallow: /dashboard
Disallow: /admin
Disallow: /cart
Disallow: /checkout
Disallow: /sign-in
Disallow: /sign-up
Disallow: /banned
Disallow: /not-available
Disallow: /offline
Disallow: /api

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: Amazonbot
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: Meta-ExternalAgent
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: AhrefsBot
Crawl-delay: 60

User-agent: MJ12bot
Disallow: /

Sitemap: https://thegrainline.com/sitemap_index.xml
`;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain" },
  });
}
