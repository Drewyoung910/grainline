import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { validateUploadFile, validateUploadSelection } from "../src/lib/uploadRules.ts";

const path = "src/components/CaseReplyBox.tsx";

function uploadEvidenceSlice() {
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "uploadEvidence") found = node.getText(sf);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.ok(found, "uploadEvidence is absent");
  return ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

async function upload(file, shrunk) {
  const sent = [];
  let evidence = [];
  const scope = {
    MAX_CASE_MESSAGE_ATTACHMENTS: 4,
    evidence: [],
    caseId: "case",
    fileInputRef: { current: null },
    setEvidence: (update) => {
      evidence = update(evidence);
    },
    setError() {},
    validateUploadFile,
    validateUploadSelection,
    shrinkLargeImageForRouteUpload: async () => shrunk,
    fetch: async (_url, init) => {
      sent.push(init.body.get("file"));
      return { ok: true, json: async () => ({ key: "evidence-key" }) };
    },
  };
  const names = Object.keys(scope);
  const run = new Function(...names, `${uploadEvidenceSlice()}; return uploadEvidence;`)(
    ...names.map((name) => scope[name]),
  );
  await run([file]);
  return { sent, evidence };
}

const MB = 1024 * 1024;
const photo = (name, size) => new File([new Uint8Array(size)], name, { type: "image/jpeg" });

test("a large phone photo of damage is shrunk first and then sent as evidence", async () => {
  const shrunk = photo("damage-optimized.jpg", 3 * MB);
  const { sent, evidence } = await upload(photo("damage.jpg", 12 * MB), shrunk);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, "damage-optimized.jpg");
  assert.equal(evidence[0].key, "evidence-key");
  assert.equal(evidence[0].error, null);
});

test("a photo that stays over the cap after shrinking is refused, not sent", async () => {
  const { sent, evidence } = await upload(photo("huge.jpg", 40 * MB), photo("huge-optimized.jpg", 9 * MB));
  assert.equal(sent.length, 0);
  assert.match(evidence[0].error, /under 8 MB/);
});
