// Fixed subprocess adapter shared by disposable and dormant admitted execution.
// The caller validates the destination; no public/IPC invocation accepts args.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const RESOLUTION_GUARD = `
import {registerHooks} from 'node:module';
import fs from 'node:fs'; import {fileURLToPath} from 'node:url';
const root=fs.realpathSync(process.cwd())+'/';
const config=fs.realpathSync(process.argv[process.argv.indexOf('--config')+1]);
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);
if(!result.url.startsWith('node:')) {
if(!result.url.startsWith('file:')) throw new Error('Execution module fallback denied');
const file=fs.realpathSync(fileURLToPath(result.url));
if(file!==config&&!file.startsWith(root)) throw new Error('Execution module fallback denied');
} return result;}});
`;

export async function runOrderPrefixPrisma({ sourceRoot, parent, databaseUrl, args, checkpoint }) {
  assert.equal(process.cwd(), sourceRoot); assert.equal(fs.realpathSync(sourceRoot), sourceRoot);
  assert.equal(fs.realpathSync(parent), parent);
  assert.ok(args.length === 4 && args[0] === "migrate" && ["deploy", "status"].includes(args[1]) && args[2] === "--config");
  await checkpoint();
  const child = spawn(fs.realpathSync(process.execPath), ["--import", `data:text/javascript,${encodeURIComponent(RESOLUTION_GUARD)}`,
    path.join(sourceRoot, "node_modules/prisma/build/index.js"), ...args], {
    cwd: sourceRoot, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: `${path.dirname(fs.realpathSync(process.execPath))}:/usr/bin:/bin`, TZ: "UTC", LANG: "C", LC_ALL: "C",
      HOME: parent, XDG_CACHE_HOME: parent, CHECKPOINT_DISABLE: "1", DIRECT_URL: databaseUrl },
  });
  let output = 0, stopped = false, checking;
  const stop = () => { stopped = true; child.kill("SIGKILL"); };
  for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { output += bytes.length; if (output > 1024 * 1024) stop(); });
  const timeout = setTimeout(stop, 180000);
  const heartbeat = setInterval(() => {
    if (checking || stopped) return;
    checking = checkpoint().catch(stop).finally(() => { checking = undefined; });
  }, 1000);
  try {
    await new Promise((resolve, reject) => {
      child.on("error", () => reject(new Error("Order Prisma command failed")));
      child.on("exit", code => { if (code === 0 && !stopped) resolve(); else reject(new Error("Order Prisma command failed")); });
    });
  } finally { clearTimeout(timeout); clearInterval(heartbeat); await checking; }
  assert.equal(stopped, false);
  await checkpoint();
}
