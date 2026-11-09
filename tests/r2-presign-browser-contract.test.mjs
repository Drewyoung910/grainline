import assert from "node:assert/strict";
import { test } from "node:test";

process.env.CLOUDFLARE_R2_ACCOUNT_ID = "acct";
process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "key";
process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "secret";
process.env.CLOUDFLARE_R2_BUCKET_NAME = "bucket";
process.env.CLOUDFLARE_R2_PUBLIC_URL = "https://cdn.example.test";

const { presignDirectUploadUrl } = await import("../src/lib/r2.ts");

async function presigned() {
  return new URL(await presignDirectUploadUrl({
    bucket: "bucket",
    key: "messageAny/user/file.pdf",
    contentType: "application/pdf",
    size: 1000,
    cacheControl: "public, max-age=1",
  }));
}

test("the browser PUT goes to the exact host the Content-Security-Policy allows (LAB-05)", async () => {
  const url = await presigned();
  assert.equal(url.origin, "https://acct.r2.cloudflarestorage.com");
  assert.equal(url.pathname, "/bucket/messageAny/user/file.pdf");
});

test("Content-Type and size are signed, so a client cannot store another type (S-01)", async () => {
  const signed = (await presigned()).searchParams.get("X-Amz-SignedHeaders").split(";");
  assert.ok(signed.includes("content-type"), signed.join(";"));
  assert.ok(signed.includes("content-length"), signed.join(";"));
});

test("the URL carries no checksum of an empty body", async () => {
  const keys = [...(await presigned()).searchParams.keys()].map((key) => key.toLowerCase());
  assert.deepEqual(keys.filter((key) => key.includes("checksum")), []);
});
