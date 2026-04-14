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

User-agent: SemrushBot
Disallow: /

User-agent: AhrefsBot
Crawl-delay: 60

User-agent: MJ12bot
Disallow: /

Sitemap: https://thegrainline.com/sitemap.xml
`;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain" },
  });
}
