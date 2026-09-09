// Credential-free subprocess harness for the actual operator entry. Synthetic
// imports expose no provider/database operations or real private-file loader.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../scripts/order-staff-read-bootstrap-operator.mjs", import.meta.url), "utf8");
const cases = ["matching", "wrong-cwd", "module-alias", "cwd-alias", "module-query"];
const results = [];
for (const kind of cases) {
  for (const entry of ["imported", "cli"]) {
    let privateLoads = 0, observedDirectory, stdout = "", stderr = "";
    const moduleRoot = "/synthetic/source";
    const workingDirectory = kind === "wrong-cwd" ? "/synthetic/other" :
      kind === "cwd-alias" ? "/synthetic/source-alias" : moduleRoot;
    const script = `${moduleRoot}/scripts/order-staff-read-bootstrap-operator.mjs`;
    const moduleUrl = pathToFileURL(script).href + (kind === "module-query" ? "?unreviewed" : "");
    const authority = "create-and-verify-authority-free-login-only";
    const processFixture = { cwd: () => workingDirectory, env: {}, exitCode: 0,
      argv: entry === "cli" ? ["node", script, "--manifest-sha256", "a".repeat(64), "--confirm", authority] : [],
      stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } };
    const context = vm.createContext({ process: processFixture });
    const inputs = { reviewed: {}, directory: "/synthetic/private", manifestSha256: "a".repeat(64), verifyManifest() {} };
    const imports = {
      "node:assert/strict": { default: assert }, "node:path": { default: path },
      "node:url": { fileURLToPath, pathToFileURL },
      "node:fs": { default: { realpathSync: file => kind === "module-alias" && file === script ? `${script}.actual` : file } },
      "./order-staff-read-bootstrap-private-inputs.mjs": {
        STAFF_BOOTSTRAP_AUTHORITY: authority,
        createStaffBootstrapPrivateInputs() { privateLoads++; return inputs; },
      },
      "./order-staff-read-bootstrap-observations.mjs": {
        collectStaffBootstrapObservations({ directory }) { observedDirectory = directory; return {}; },
      },
      "./order-staff-read-bootstrap-coordinator.mjs": {
        async coordinateStaffBootstrap({ observeRelease }) { await observeRelease(); return { status: "synthetic-only" }; },
      },
    };
    const subject = new vm.SourceTextModule(source, { context, identifier: moduleUrl,
      initializeImportMeta(meta) { meta.url = moduleUrl; } });
    await subject.link(specifier => {
      assert.ok(Object.hasOwn(imports, specifier));
      const exports = imports[specifier];
      return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      }, { context });
    });
    await subject.evaluate();
    let accepted = false;
    if (entry === "imported") {
      try {
        await subject.namespace.runStaffBootstrapFromApprovedManifest({ confirmation: authority, manifestSha256: "a".repeat(64) });
        accepted = true;
      } catch (error) { assert.equal(error.message, "staff bootstrap operator stopped; preserve the exact private inputs and journal"); }
    } else {
      accepted = stdout.includes("synthetic-only");
      if (kind !== "matching" && kind !== "module-query") assert.equal(processFixture.exitCode, 1);
    }
    assert.equal(accepted, kind === "matching");
    assert.equal(privateLoads, kind === "matching" ? 1 : 0);
    assert.equal(observedDirectory, kind === "matching" ? moduleRoot : undefined);
    assert.ok(!stderr.includes("synthetic/private"));
    results.push({ kind, entry, accepted, privateLoads });
  }
}
console.log(JSON.stringify(results));
