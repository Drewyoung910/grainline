// src/app/robots.txt/route.ts
import { NextResponse } from "next/server";

export function GET() {
  const body = `User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /admin
Disallow: /cart
Disallow: /checkout
Disallow: /api

Sitemap: https://grainline.co/sitemap.xml
`;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain" },
  });
}
