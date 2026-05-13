import { NextResponse } from "next/server";

const SECURITY_TXT_EXPIRES = "2027-05-13T00:00:00Z";

export function GET() {
  const body = [
    "Contact: mailto:security@thegrainline.com",
    "Policy: https://thegrainline.com/security",
    "Preferred-Languages: en",
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    "Canonical: https://thegrainline.com/.well-known/security.txt",
    "",
  ].join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
