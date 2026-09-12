import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);
const adapter = pathToFileURL(path.resolve("scripts/order-zero-direct-execution-prisma.mjs")).href;
// Actual subprocesses with a deliberately fake Prisma CLI: proves transport,
// loader and cancellation properties without any database or install access.
test("fixed Prisma transport scrubs credentials, constrains imports and joins late guard failures", async t => {
  for (const scenario of ["deploy", "status", "unknown-command", "ambient-import", "pending-loss", "late-loss"]) {
    const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-prisma-transport-"));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const root = path.join(parent, "source"), config = path.join(parent, "prisma.config.mjs"), marker = path.join(parent, "result.json");
    fs.mkdirSync(path.join(root, "node_modules/prisma/build"), { recursive: true });
    fs.writeFileSync(config, "export default {};\n");
    fs.writeFileSync(path.join(parent, "outside.cjs"), "throw new Error('outside module executed');");
    const script = `const fs=require('node:fs'),assert=require('node:assert/strict');
assert.equal(process.cwd(),${JSON.stringify(root)});
assert.equal(process.env.DIRECT_URL,'postgresql://fixture.invalid/no-connection');
for(const name of ['DATABASE_URL','GH_TOKEN','NODE_OPTIONS','NODE_PATH','HTTPS_PROXY','PRISMA_ENGINES_MIRROR'])assert.equal(process.env[name],undefined);
assert.equal(process.argv.at(-1),${JSON.stringify(config)});
fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,command:process.argv[3],scrubbed:true}));
${scenario === "ambient-import" ? `require(${JSON.stringify(path.join(parent, "outside.cjs"))});` : ""}
${scenario === "pending-loss" ? "setInterval(()=>{},1000);" : scenario === "late-loss" ? "setTimeout(()=>process.exit(0),1200);" : ""}
`;
    fs.writeFileSync(path.join(root, "node_modules/prisma/build/index.js"), script);
    const runner = `import assert from 'node:assert/strict';
import {runOrderPrefixPrisma} from ${JSON.stringify(adapter)};
Object.assign(process.env,{DATABASE_URL:'fixture-only',GH_TOKEN:'fixture-only',NODE_OPTIONS:'--require=/nonexistent',NODE_PATH:'/nonexistent',HTTPS_PROXY:'https://invalid.example',PRISMA_ENGINES_MIRROR:'https://invalid.example'});
let calls=0;
const checkpoint=async()=>{calls++;if(calls===2&&${JSON.stringify(["pending-loss", "late-loss"].includes(scenario))}){
${scenario === "late-loss" ? "await new Promise(resolve=>setTimeout(resolve,500));" : ""}
throw new Error('fixture credential must never escape');}};
let passed=false;
try {await runOrderPrefixPrisma({sourceRoot:process.cwd(),parent:${JSON.stringify(parent)},databaseUrl:'postgresql://fixture.invalid/no-connection',
args:['migrate',${JSON.stringify(scenario === "unknown-command" ? "resolve" : scenario === "status" ? "status" : "deploy")},'--config',${JSON.stringify(config)}],checkpoint});passed=true;}
catch(error){assert.ok(!error.message.includes('fixture credential'));}
assert.equal(passed,${JSON.stringify(["deploy", "status"].includes(scenario))});
process.stdout.write(JSON.stringify({passed,calls}));
`;
    const result = await exec(process.execPath, ["--input-type=module", "--eval", runner], { cwd: root, timeout: 15000,
      env: { PATH: "/usr/bin:/bin", TZ: "UTC", LANG: "C", LC_ALL: "C" }, maxBuffer: 4096 });
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).passed, ["deploy", "status"].includes(scenario));
    if (scenario === "unknown-command") assert.equal(fs.existsSync(marker), false);
    else {
      const observed = JSON.parse(fs.readFileSync(marker)); assert.equal(observed.scrubbed, true);
      assert.throws(() => process.kill(observed.pid, 0), { code: "ESRCH" });
    }
  }
});
