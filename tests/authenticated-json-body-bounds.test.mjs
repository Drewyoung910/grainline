import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const boundedMutationRoutes = [
  {
    path: "src/app/api/cart/checkout-seller/route.ts",
    requestName: "req",
    maxBytesConst: "CHECKOUT_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/cart/checkout/single/route.ts",
    requestName: "req",
    maxBytesConst: "CHECKOUT_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/shipping/quote/route.ts",
    requestName: "req",
    maxBytesConst: "SHIPPING_QUOTE_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/upload/presign/route.ts",
    requestName: "req",
    maxBytesConst: "UPLOAD_PRESIGN_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/upload/verify/route.ts",
    requestName: "req",
    maxBytesConst: "UPLOAD_VERIFY_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/seller/broadcast/route.ts",
    requestName: "req",
    maxBytesConst: "BROADCAST_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/admin/email/route.ts",
    requestName: "request",
    maxBytesConst: "ADMIN_EMAIL_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/users/[id]/report/route.ts",
    requestName: "req",
    maxBytesConst: "USER_REPORT_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/cases/route.ts",
    requestName: "req",
    maxBytesConst: "CASE_CREATE_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/cases/[id]/messages/route.ts",
    requestName: "req",
    maxBytesConst: "CASE_MESSAGE_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/cases/[id]/resolve/route.ts",
    requestName: "req",
    maxBytesConst: "CASE_RESOLVE_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/messages/custom-order-request/route.ts",
    requestName: "req",
    maxBytesConst: "CUSTOM_ORDER_REQUEST_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/reviews/route.ts",
    requestName: "req",
    maxBytesConst: "REVIEW_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/reviews/[id]/reply/route.ts",
    requestName: "req",
    maxBytesConst: "REVIEW_REPLY_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/reviews/[id]/route.ts",
    requestName: "req",
    maxBytesConst: "REVIEW_PATCH_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/commission/route.ts",
    requestName: "req",
    maxBytesConst: "COMMISSION_CREATE_BODY_MAX_BYTES",
  },
  {
    path: "src/app/api/commission/[id]/route.ts",
    requestName: "req",
    maxBytesConst: "COMMISSION_STATUS_BODY_MAX_BYTES",
  },
];

describe("authenticated JSON mutation body bounds", () => {
  for (const route of boundedMutationRoutes) {
    it(`${route.path} bounds JSON before parsing`, () => {
      const text = source(route.path);
      assert.match(text, new RegExp(`const ${route.maxBytesConst} = `));
      assert.match(text, new RegExp(`readBoundedJson\\(${route.requestName}, ${route.maxBytesConst}\\)`));
      assert.match(text, /isRequestBodyTooLargeError/);
      assert.match(text, /status: 413/);
      assert.doesNotMatch(text, /await (?:req|request)\.json\(\)(?:\.catch)?/);
    });
  }
});
