import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { staffBootstrapOperatorSourceDirectory } from "../scripts/order-staff-read-bootstrap-operator.mjs";

test("operator root binds the actual canonical script to cwd and rejects unrelated roots and aliases", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-staff-source-test-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "checkout");
  fs.mkdirSync(path.join(repository, "scripts"), { recursive: true });
  const script = path.join(repository, "scripts", "order-staff-read-bootstrap-operator.mjs");
  fs.writeFileSync(script, "// Inert source path fixture.\n");
  const url = pathToFileURL(script).href;
  assert.equal(staffBootstrapOperatorSourceDirectory(url, repository), repository);
  fs.mkdirSync(path.join(root, "other-checkout"));
  fs.symlinkSync(repository, path.join(root, "alias"));
  const otherName = path.join(repository, "scripts", "another-operator.mjs");
  fs.writeFileSync(otherName, "// Inert fixture.\n");
  const aliasScript = path.join(root, "alias", "scripts", path.basename(script));
  for (const [moduleUrl, cwd] of [
    [url, path.join(root, "other-checkout")], [url, `${repository}/scripts`],
    [url, `${repository}/../checkout`], [url, path.join(root, "alias")],
    [pathToFileURL(aliasScript).href, path.join(root, "alias")],
    [`${url}?alternate`, repository], [`${url}#alternate`, repository],
    [url.replace("file:///", "file://localhost/"), repository],
    [pathToFileURL(otherName).href, repository], ["https://example.invalid/operator.mjs", repository],
  ]) assert.throws(() => staffBootstrapOperatorSourceDirectory(moduleUrl, cwd), /operator stopped/u);
});

test("real imported and CLI operator entries reject mismatched roots before loading private inputs", () => {
  const harness = fileURLToPath(new URL("./helpers/staff-bootstrap-operator-source-harness.mjs", import.meta.url));
  const output = execFileSync(process.execPath, ["--experimental-vm-modules", harness], {
    encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" },
  });
  const results = JSON.parse(output);
  assert.equal(results.length, 10);
  assert.equal(results.filter(result => result.accepted).length, 2);
  assert.ok(results.filter(result => !result.accepted).every(result => result.privateLoads === 0));
});
