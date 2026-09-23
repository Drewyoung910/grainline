import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { createOrderExecutionJournal } from "../scripts/order-zero-direct-execution-journal.mjs";

const binding = { initialPrefix: 0, releaseCommit: "a".repeat(40), prefixCatalogSha256: "b".repeat(64), sourceCatalogSha256: "c".repeat(64) };
function directory(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-journal-test-"));
  fs.chmodSync(dir, 0o700); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
test("durable stages bind one attempt; only complete releases its claim", t => {
  for (const initialPrefix of [0, 17]) {
    const dir = directory(t), input = { ...binding, initialPrefix };
    const journal = createOrderExecutionJournal({ directory: dir, binding: input });
    input.releaseCommit = "d".repeat(40);
    for (const stage of ["prepared", ...(initialPrefix < 17 ? ["apply-intent"] : []), "prefix-verified", "grant-intent", "grants-verified", "status-verified", "audit-verified", "complete"]) {
      journal.advance(stage);
      const saved = JSON.parse(fs.readFileSync(path.join(dir, "execution.json")));
      assert.equal(saved.stage, stage); assert.equal(saved.releaseCommit, binding.releaseCommit);
      assert.deepEqual(journal.verify(), saved); assert.equal(saved.productionExecutionAuthorized, false);
      assert.equal(fs.statSync(path.join(dir, "execution.json")).mode & 0o777, 0o600);
    }
    journal.close(); journal.close(); assert.equal(fs.existsSync(path.join(dir, "execution.lock")), false);
    assert.throws(() => createOrderExecutionJournal({ directory: dir, binding }));
    assert.throws(() => journal.advance("prepared"));
  }
});
test("incomplete, tampered and out-of-order attempts preserve the exclusive claim", t => {
  for (const change of [
    (journal) => journal.advance("complete"),
    (_, dir) => fs.writeFileSync(path.join(dir, "execution.json"), "tampered"),
    (_, dir) => fs.chmodSync(path.join(dir, "execution.lock"), 0o644),
    (_, dir) => fs.writeFileSync(path.join(dir, "execution.pending"), "partial"),
    (_, dir) => { fs.unlinkSync(path.join(dir, "execution.lock")); fs.symlinkSync("execution.json", path.join(dir, "execution.lock")); },
  ]) {
    const dir = directory(t), journal = createOrderExecutionJournal({ directory: dir, binding });
    journal.advance("prepared"); journal.advance("apply-intent");
    try { change(journal, dir); } catch { /* Illegal transition already poisons it. */ }
    assert.throws(() => journal.verify()); journal.close();
    assert.ok(fs.lstatSync(path.join(dir, "execution.lock")));
    assert.throws(() => createOrderExecutionJournal({ directory: dir, binding }));
  }
});
test("competing writers and unsafe directories cannot take over an attempt", t => {
  const dir = directory(t), journal = createOrderExecutionJournal({ directory: dir, binding });
  assert.throws(() => createOrderExecutionJournal({ directory: dir, binding }));
  journal.advance("prepared"); journal.close();
  const unsafe = directory(t); fs.chmodSync(unsafe, 0o755);
  assert.throws(() => createOrderExecutionJournal({ directory: unsafe, binding }));
  const empty = directory(t);
  assert.throws(() => createOrderExecutionJournal({ directory: empty, binding: { ...binding, credential: "forbidden" } }));
});
test("SIGKILL after apply intent leaves durable evidence and forbids automatic restart", async t => {
  const dir = directory(t), moduleUrl = new URL("../scripts/order-zero-direct-execution-journal.mjs", import.meta.url).href;
  const code = `import {createOrderExecutionJournal} from ${JSON.stringify(moduleUrl)};
const journal=createOrderExecutionJournal(${JSON.stringify({ directory: dir, binding })});
journal.advance('prepared');journal.advance('apply-intent');process.send('ready');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "ignore", "ipc"], env: {} });
  t.after(() => child.kill("SIGKILL"));
  await once(child, "message"); const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "execution.json"))).stage, "apply-intent");
  assert.ok(fs.existsSync(path.join(dir, "execution.lock")));
  assert.throws(() => createOrderExecutionJournal({ directory: dir, binding }));
});

test("failed durability writes poison the attempt and retain its claim", t => {
  const dir = directory(t), journal = createOrderExecutionJournal({ directory: dir, binding });
  journal.advance("prepared");
  const original = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw new Error("injected durability failure"); };
    assert.throws(() => journal.advance("apply-intent"));
  } finally { fs.fsyncSync = original; }
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "execution.json"))).stage, "prepared");
  assert.ok(fs.existsSync(path.join(dir, "execution.pending")));
  assert.throws(() => journal.verify()); journal.close();
  assert.ok(fs.existsSync(path.join(dir, "execution.lock")));
  assert.throws(() => createOrderExecutionJournal({ directory: dir, binding }));
});
