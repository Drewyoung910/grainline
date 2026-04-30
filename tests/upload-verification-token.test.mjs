import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.UPLOAD_VERIFICATION_SECRET = "test-upload-secret";

const {
  createUploadVerificationToken,
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

  it("scopes uploaded keys to the authenticated user and endpoint", () => {
    assert.equal(uploadKeyBelongsToUser("listingVideo/user_123/file.mp4", "listingVideo", "user_123"), true);
    assert.equal(uploadKeyBelongsToUser("listingVideo/user_456/file.mp4", "listingVideo", "user_123"), false);
    assert.equal(uploadKeyBelongsToUser("messageFile/user_123/file.pdf", "listingVideo", "user_123"), false);
    assert.equal(uploadKeyBelongsToUser("listingVideo/user_123/../file.mp4", "listingVideo", "user_123"), false);
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
