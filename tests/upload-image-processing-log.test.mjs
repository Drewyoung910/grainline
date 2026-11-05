import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);

test("a failed image process is logged, not only answered with a 400", async () => {
  const path = "src/app/api/upload/image/route.ts";
  const logged = [];
  const stub = () => new Proxy(function () {}, {
    get: (_target, key) => (key === "then" ? undefined : stub()),
    apply: () => undefined,
  });
  const dependencies = {
    zod: require("zod"),
    sharp: {
      default: () => {
        throw new Error("sharp ran out of memory");
      },
    },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "buyer", role: "USER" }) },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true, reset: 0 }) },
    "@/lib/requestBody": { assertKnownContentLengthUnder() {} },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/uploadRules": {
      IMAGE_UPLOAD_ENDPOINTS: ["reviewPhoto"],
      IMAGE_UPLOAD_TYPES: ["image/jpeg"],
      UPLOAD_MAX_COUNTS: { reviewPhoto: 6 },
      UPLOAD_MAX_SIZES: { reviewPhoto: 8 * 1024 * 1024 },
    },
    "@/lib/privateResponse": { privateJson: (body, init) => Response.json(body, init) },
    "@/lib/uploadVerificationToken": { uploadFileSignatureMatches: () => true },
    "@/lib/serverErrorLogger": { logServerError: (error, context) => logged.push([error.message, context.source]) },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, Buffer, File, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });

  const form = new FormData();
  form.set("endpoint", "reviewPhoto");
  form.set("file", new File([new Uint8Array(16)], "photo.jpg", { type: "image/jpeg" }));
  const response = await exports.POST(new Request("https://example.test/api/upload/image", { method: "POST", body: form }));

  assert.equal(response.status, 400);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], "sharp ran out of memory");
  assert.equal(logged[0][1], "upload_image_processing");
});
