import { execFile } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

const FAIL = "R2 GitHub authorization refused; no CLI credential or diagnostic disclosed.";
const check = value => { if (!value) throw new Error(FAIL); };
const same = (a, b) => ["dev", "ino", "uid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].every(key => a[key] === b[key]);
const directory = path => {
  check(typeof path === "string" && isAbsolute(path) && realpathSync(path) === path);
  const stat = lstatSync(path, { bigint: true }); check(stat.isDirectory() && stat.uid === BigInt(process.getuid()));
  return stat;
};

// Explicit pinned CLI and account/config locations only. Token lookup inherits
// no GH_TOKEN/GITHUB_TOKEN or shell environment and prints no captured output.
export function makeR2GitHubCliAuthorization({ executable, executableSha256, home, configDirectory, execute = execFile }) {
  return async (callback, { signal } = {}) => {
    let beforeToken, afterToken;
    try {
      check(typeof callback === "function" && typeof execute === "function" && typeof executable === "string"
        && isAbsolute(executable) && /^[a-f0-9]{64}$/.test(executableSha256));
      const bounded = AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]); bounded.throwIfAborted();
      const homeStat = directory(home), configStat = directory(configDirectory);
      const guardDirectory = (path, expected) => {
        const current = directory(path); check(["dev", "ino", "uid", "mode"].every(key => current[key] === expected[key]));
      };
      const inspect = () => {
        bounded.throwIfAborted(); guardDirectory(home, homeStat); guardDirectory(configDirectory, configStat);
        check(realpathSync(executable) === executable);
        const stat = lstatSync(executable, { bigint: true });
        check(stat.isFile() && stat.nlink === 1n && stat.size > 0n && stat.size <= 104857600n
          && (stat.mode & 0o022n) === 0n && (stat.mode & 0o111n) !== 0n);
        const fd = openSync(executable, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          check(same(stat, fstatSync(fd, { bigint: true })));
          const bytes = readFileSync(fd);
          check(createHash("sha256").update(bytes).digest("hex") === executableSha256
            && same(stat, fstatSync(fd, { bigint: true })) && same(stat, lstatSync(executable, { bigint: true })));
          return stat;
        } finally { closeSync(fd); }
      };
      const original = inspect();
      const readToken = async () => {
        check(same(original, inspect()));
        const result = await new Promise((resolve, reject) => {
          execute(executable, ["auth", "token", "--hostname", "github.com"], {
            cwd: home, env: { HOME: home, PATH: "/usr/bin:/bin", GH_CONFIG_DIR: configDirectory, GH_HOST: "github.com",
              GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_PAGER: "cat" },
            encoding: "buffer", maxBuffer: 4096, timeout: 10000, signal: bounded, windowsHide: true,
          }, (error, stdout, stderr) => {
            if (Buffer.isBuffer(stderr)) stderr.fill(0);
            if (error || !Buffer.isBuffer(stdout)) { if (Buffer.isBuffer(stdout)) stdout.fill(0); reject(new Error(FAIL)); return; }
            resolve(stdout);
          });
        });
        try {
          check(same(original, inspect()));
          const token = result.toString("utf8").trim(); check(/^[A-Za-z0-9_]{20,512}$/.test(token));
          return Buffer.from(token);
        } finally { result.fill(0); }
      };
      beforeToken = await readToken(); const result = await callback(beforeToken.toString("utf8"));
      bounded.throwIfAborted(); afterToken = await readToken();
      check(beforeToken.length === afterToken.length && timingSafeEqual(beforeToken, afterToken));
      bounded.throwIfAborted(); return result;
    } catch { throw new Error(FAIL); }
    finally { beforeToken?.fill(0); afterToken?.fill(0); }
  };
}
