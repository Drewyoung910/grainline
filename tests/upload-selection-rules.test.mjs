import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_ORIGINAL_MAX_BYTES,
  validateUploadFile,
  validateUploadSelection,
} from "../src/lib/uploadRules.ts";

const MB = 1024 * 1024;

test("a large phone photo is accepted when picked, because the browser shrinks it first", () => {
  assert.doesNotThrow(() => validateUploadSelection("reviewPhoto", { size: 14 * MB, type: "image/jpeg" }));
  assert.doesNotThrow(() => validateUploadSelection("caseEvidenceImage", { size: 30 * MB, type: "image/png" }));
});

test("the endpoint's cap still applies to what is actually sent", () => {
  assert.throws(() => validateUploadFile("reviewPhoto", { size: 14 * MB, type: "image/jpeg" }), /under 8 MB/);
});

test("a picked photo still has an upper limit, a type check and a count check", () => {
  assert.throws(
    () => validateUploadSelection("reviewPhoto", { size: IMAGE_ORIGINAL_MAX_BYTES + 1, type: "image/jpeg" }),
    /Review photo must be under 50 MB/,
  );
  assert.throws(() => validateUploadSelection("reviewPhoto", { size: MB, type: "image/gif" }), /Only JPEG/);
  assert.throws(() => validateUploadSelection("bannerImage", { size: MB, type: "image/jpeg" }, 1), /Up to 1 file/);
});

test("files the browser cannot shrink keep their own cap", () => {
  assert.throws(() => validateUploadSelection("messageAny", { size: 9 * MB, type: "application/pdf" }), /under 8 MB/);
  assert.throws(() => validateUploadSelection("listingVideo", { size: 129 * MB, type: "video/mp4" }), /under 128 MB/);
});
