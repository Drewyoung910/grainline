import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { uploadedFileUrl, uploadedFileUrls } = await import("../src/lib/uploadedFileUrl.ts");

describe("uploaded file URL helpers", () => {
  it("prefers url while preserving ufsUrl compatibility", () => {
    assert.equal(uploadedFileUrl({ url: "https://cdn.example/new.jpg", ufsUrl: "https://cdn.example/old.jpg" }), "https://cdn.example/new.jpg");
    assert.equal(uploadedFileUrl({ ufsUrl: "https://cdn.example/old.jpg" }), "https://cdn.example/old.jpg");
  });

  it("supports legacy serverData upload payloads", () => {
    assert.equal(uploadedFileUrl({ serverData: { url: "https://cdn.example/server.jpg" } }), "https://cdn.example/server.jpg");
  });

  it("filters missing URLs from collections", () => {
    assert.deepEqual(uploadedFileUrls([{ url: "https://cdn.example/a.jpg" }, {}, null]), ["https://cdn.example/a.jpg"]);
  });
});
