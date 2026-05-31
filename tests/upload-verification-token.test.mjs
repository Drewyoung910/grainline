import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

process.env.UPLOAD_VERIFICATION_SECRET = "test-upload-secret";

const {
  createUploadVerificationToken,
  uploadVerificationExpiresAtIsTooFarFuture,
  uploadFileSignatureMatches,
  uploadedObjectVerificationError,
  uploadContentTypeMatches,
  uploadKeyBelongsToUser,
  verifyUploadVerificationToken,
} = await import("../src/lib/uploadVerificationToken.ts");

describe("upload verification tokens", () => {
  const now = 1_800_000_000_000;
  const fields = {
    key: "listingVideo/user_123/1800000000-random.mp4",
    endpoint: "listingVideo",
    expectedSize: 4_096,
    contentType: "video/mp4",
  };

  it("binds verification to key, endpoint, size, content type, and expiry", () => {
    const signed = createUploadVerificationToken(fields, now);
    assert.ok(signed);
    assert.equal(
      verifyUploadVerificationToken({ ...fields, expiresAt: signed.expiresAt }, signed.token, now),
      true,
    );
    assert.equal(
      verifyUploadVerificationToken({ ...fields, expectedSize: fields.expectedSize + 1, expiresAt: signed.expiresAt }, signed.token, now),
      false,
    );
    assert.equal(
      verifyUploadVerificationToken({ ...fields, contentType: "application/pdf", expiresAt: signed.expiresAt }, signed.token, now),
      false,
    );
    assert.equal(
      verifyUploadVerificationToken({ ...fields, endpoint: "messageFile", expiresAt: signed.expiresAt }, signed.token, now),
      false,
    );
  });

  it("rejects expired, malformed, and tampered tokens", () => {
    const signed = createUploadVerificationToken(fields, now);
    assert.ok(signed);
    assert.equal(
      verifyUploadVerificationToken({ ...fields, expiresAt: signed.expiresAt }, signed.token, signed.expiresAt),
      true,
    );
    assert.equal(
      verifyUploadVerificationToken({ ...fields, expiresAt: signed.expiresAt }, signed.token, signed.expiresAt + 1),
      false,
    );
    assert.equal(
      verifyUploadVerificationToken({ ...fields, expiresAt: signed.expiresAt }, "not-hex", now),
      false,
    );
    assert.equal(
      verifyUploadVerificationToken({ ...fields, expiresAt: signed.expiresAt }, "0".repeat(64), now),
      false,
    );
  });

  it("rejects verification tokens with excessive future expiry", () => {
    const signed = createUploadVerificationToken(fields, now + 5 * 60 * 1000 + 1);
    assert.ok(signed);
    assert.equal(uploadVerificationExpiresAtIsTooFarFuture(signed.expiresAt, now), true);
    assert.equal(
      verifyUploadVerificationToken({ ...fields, expiresAt: signed.expiresAt }, signed.token, now),
      false,
    );
  });

  it("rejects excessive future upload verification expiry at the route schema boundary", () => {
    const route = readFileSync("src/app/api/upload/verify/route.ts", "utf8");

    assert.match(route, /uploadVerificationExpiresAtIsTooFarFuture/);
    assert.match(route, /verificationExpiresAt: z\.number\(\)\.int\(\)\.positive\(\)\.refine/);
    assert.doesNotMatch(route, /verificationExpiresAt: z\.number\(\)\.int\(\)\.positive\(\),/);
  });

  it("scopes uploaded keys to the authenticated user and endpoint", () => {
    assert.equal(uploadKeyBelongsToUser("listingVideo/user_123/file.mp4", "listingVideo", "user_123"), true);
    assert.equal(uploadKeyBelongsToUser("listingVideo/user____bad_name/file.mp4", "listingVideo", "user/../bad:name"), true);
    assert.equal(uploadKeyBelongsToUser("listingVideo/user_456/file.mp4", "listingVideo", "user_123"), false);
    assert.equal(uploadKeyBelongsToUser("messageFile/user_123/file.pdf", "listingVideo", "user_123"), false);
    assert.equal(uploadKeyBelongsToUser("listingVideo/user_123/../file.mp4", "listingVideo", "user_123"), false);
    assert.equal(uploadKeyBelongsToUser("listingVideo/user/../bad:name/file.mp4", "listingVideo", "user/../bad:name"), false);
  });

  it("requires actual object size and content type to match signed metadata exactly", () => {
    assert.equal(uploadContentTypeMatches("video/mp4; charset=binary", "video/mp4"), true);
    assert.equal(uploadContentTypeMatches("application/pdf", "video/mp4"), false);
    assert.equal(
      uploadedObjectVerificationError({
        actualSize: 4_096,
        expectedSize: 4_096,
        maxSize: 8_192,
        actualContentType: "video/mp4",
        expectedContentType: "video/mp4",
      }),
      null,
    );
    assert.equal(
      uploadedObjectVerificationError({
        actualSize: 4_097,
        expectedSize: 4_096,
        maxSize: 8_192,
        actualContentType: "video/mp4",
        expectedContentType: "video/mp4",
      }),
      "Uploaded file size did not match the signed upload.",
    );
    assert.equal(
      uploadedObjectVerificationError({
        actualSize: 4_096,
        expectedSize: 4_096,
        maxSize: 8_192,
        actualContentType: "application/pdf",
        expectedContentType: "video/mp4",
      }),
      "Uploaded file type did not match the signed upload.",
    );
  });

  it("validates direct-upload file signatures for images, PDFs, and videos", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webp = new TextEncoder().encode("RIFFxxxxWEBPVP8 ");
    const pdf = new TextEncoder().encode("%PDF-1.7\n...");
    const mp4 = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d,
      0x00, 0x00, 0x02, 0x00,
      0x6d, 0x70, 0x34, 0x32,
    ]);
    const html = new TextEncoder().encode("<script>alert(1)</script>");

    assert.equal(uploadFileSignatureMatches(jpeg, "image/jpeg"), true);
    assert.equal(uploadFileSignatureMatches(png, "image/png"), true);
    assert.equal(uploadFileSignatureMatches(webp, "image/webp"), true);
    assert.equal(uploadFileSignatureMatches(pdf, "application/pdf"), true);
    assert.equal(uploadFileSignatureMatches(mp4, "video/mp4"), true);
    assert.equal(uploadFileSignatureMatches(mp4, "video/quicktime"), true);
    assert.equal(uploadFileSignatureMatches(html, "image/jpeg"), false);
    assert.equal(uploadFileSignatureMatches(html, "image/png"), false);
    assert.equal(uploadFileSignatureMatches(html, "image/webp"), false);
    assert.equal(uploadFileSignatureMatches(html, "image/svg+xml"), false);
    assert.equal(uploadFileSignatureMatches(html, "application/pdf"), false);
    assert.equal(uploadFileSignatureMatches(html, "video/mp4"), false);
    assert.equal(uploadFileSignatureMatches(html, "application/octet-stream"), false);
    assert.equal(uploadFileSignatureMatches(new TextEncoder().encode("GIF89a"), "image/gif"), false);
  });

  it("verifies uploaded object signatures before accepting direct uploads", () => {
    const route = readFileSync("src/app/api/upload/verify/route.ts", "utf8");

    assert.match(route, /GetObjectCommand/);
    assert.match(route, /Range: "bytes=0-511"/);
    assert.match(route, /uploadFileSignatureMatches\(prefixBytes, contentType\)/);
    assert.match(route, /Uploaded file content did not match the signed file type/);
  });

  it("does not fall back to the R2 access key as the verification secret", () => {
    const uploadSecret = process.env.UPLOAD_VERIFICATION_SECRET;
    const r2Secret = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    delete process.env.UPLOAD_VERIFICATION_SECRET;
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "r2-secret-should-not-sign";
    try {
      assert.equal(createUploadVerificationToken(fields, now), null);
      assert.equal(
        verifyUploadVerificationToken({ ...fields, expiresAt: now + 60_000 }, "0".repeat(64), now),
        false,
      );
    } finally {
      if (uploadSecret === undefined) delete process.env.UPLOAD_VERIFICATION_SECRET;
      else process.env.UPLOAD_VERIFICATION_SECRET = uploadSecret;
      if (r2Secret === undefined) delete process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
      else process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = r2Secret;
    }
  });
});
