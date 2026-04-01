// src/app/robots.txt/route.ts
import { NextResponse } from "next/server";

export function GET() {
  const body = `User-agent: *
Allow: /
Allow: /browse/
Allow: /commission/
Allow: /makers/
Disallow: /dashboard
Disallow: /admin
Disallow: /cart
Disallow: /checkout
Disallow: /api

Sitemap: https://thegrainline.com/sitemap.xml
`;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain" },
  });
}
