import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("ordinary Message private-object remediation plan", () => {
  it("pins the current public bearer write and read surfaces", () => {
    const plan = source("docs/message-private-object-remediation-plan.md");
    const composer = source("src/components/MessageComposer.tsx");
    const imageUpload = source("src/app/api/upload/image/route.ts");
    const presign = source("src/app/api/upload/presign/route.ts");
    const threadPage = source("src/app/messages/[id]/page.tsx");
    const thread = source("src/components/ThreadMessages.tsx");

    for (const path of [
      "src/components/MessageComposer.tsx",
      "src/app/api/upload/image/route.ts",
      "src/app/api/upload/presign/route.ts",
      "src/app/messages/[id]/page.tsx",
      "src/components/ThreadMessages.tsx",
    ]) {
      assert.match(plan, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(plan, /public R2 URL[\s\S]*public bearer objects/);
    assert.match(plan, /Message\.body/);
    assert.match(plan, /Account export/);
    assert.match(plan, /Account deletion/);
    assert.match(plan, /reported-thread staff/);
    assert.match(composer, /const ENDPOINT = "messageAny"/);
    assert.match(composer, /name="attachments"/);
    assert.match(imageUpload, /Bucket: R2_BUCKET/);
    assert.match(imageUpload, /const publicUrl = `\$\{R2_PUBLIC_URL\}\/\$\{key\}`/);
    assert.match(presign, /const publicUrl = `\$\{R2_PUBLIC_URL\}\/\$\{key\}`/);
    assert.match(
      threadPage,
      /isFirstPartyMediaUrlForUser\(url, userId, \["messageAny"\]\)/,
    );
    assert.match(threadPage, /JSON\.stringify\(\{[\s\S]*url: a\.url/);
    assert.match(thread, /parseFileMessageBody\(body\)/);
  });

  it("requires source-derived private authority and keeps object keys out of reads", () => {
    const plan = source("docs/message-private-object-remediation-plan.md");

    assert.match(plan, /MessageAttachment/);
    assert.match(plan, /unique `directUploadId` foreign key/);
    assert.match(plan, /references that row by\s+id instead of duplicating the key/);
    assert.match(plan, /ENABLE plus FORCE RLS/);
    assert.match(plan, /no direct INSERT\/UPDATE\/DELETE/);
    assert.match(
      plan,
      /derive the lifecycle id, recipient, timestamp, fixed Message body\/kind,[\s\S]*byte size and content type/,
    );
    assert.match(
      plan,
      /No Message\/list\/stream\/inbox or\s+send response returns that key/,
    );
    assert.match(plan, /at\s+most a 60-second/);
    assert.match(plan, /Non-party staff must satisfy the session-bound admin PIN/);
    assert.match(plan, /one bounded batch per Message\s+page/);
    assert.match(plan, /stolen runtime credential can impersonate an existing Conversation participant/);
    assert.match(plan, /blast-radius containment, not independent sender identity/);
    assert.match(plan, /must not treat redirect `nosniff` as an\s+object-response guarantee/);
  });

  it("keeps PDFs fail-closed and legacy mutation separately approved", () => {
    const plan = source("docs/message-private-object-remediation-plan.md");

    assert.match(plan, /JPEG, PNG or WebP only/);
    assert.match(plan, /PDFs are disabled for new sends until malware scanning/);
    assert.match(plan, /aggregate counts only/);
    assert.match(plan, /must not export[\s\S]*message bodies, object URLs, object keys/);
    assert.match(plan, /Legacy copy\/rewrite:[\s\S]*separately approved/);
    assert.match(plan, /never delete the public source in\s+the same release/);
  });

  it("keeps DirectUpload and Case activation as explicit separate boundaries", () => {
    const plan = source("docs/message-private-object-remediation-plan.md");
    const matrix = source("docs/rls-coverage-matrix.md");

    assert.match(matrix, /\| `DirectUpload` \| `PLANNED_RLS` \|/);
    assert.match(plan, /DirectUpload boundary \(CM-A21\)/);
    assert.match(plan, /Do not silently bundle `DirectUpload` activation into Message or Case/);
    assert.match(plan, /complete the separate `DirectUpload` RLS\/fixed-lifecycle rollout/);
    assert.match(plan, /hard production\s+promotion gate/);
    assert.match(plan, /Case and Message object changes remain\s+separate releases/);
    assert.match(plan, /Switch to Extra\s+High before schema, function, policy, grant/);
  });
});
