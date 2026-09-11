import { existsSync, readFileSync, copyFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const flags = new Set(process.argv.slice(2));
const setup = flags.has("--setup"), checkOnly = flags.has("--check"), development = flags.has("--dev");
const log = (message) => console.log(`[Project OS] ${message}`);
const fail = (message) => { throw new Error(message); };
let child; let stopping = false; let lockOwned = false;
const lockPath = join(root, ".local", "launch.lock");
const cleanup = () => { if (lockOwned) { try { unlinkSync(lockPath); } catch {} lockOwned = false; } };
process.on("exit", cleanup);
function redact(value) {
  let result = String(value);
  if (process.env.DATABASE_URL) {
    result = result.split(process.env.DATABASE_URL).join("[DATABASE_URL hidden]");
    try { const password = decodeURIComponent(new URL(process.env.DATABASE_URL).password); if (password) result = result.split(password).join("[hidden]"); } catch {}
  }
  return result.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, "[database address hidden]");
}
function spawnSafe(command, args) {
  const proc = spawn(command, args, { cwd: root, env: process.env, stdio: ["inherit", "pipe", "pipe"] });
  // Buffer complete lines so a secret split across output chunks is still redacted.
  for (const [stream, output] of [[proc.stdout, process.stdout], [proc.stderr, process.stderr]]) {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", text => { pending += text; const lines = pending.split("\n"); pending = lines.pop() ?? ""; for (const line of lines) output.write(redact(line) + "\n"); });
    stream.on("end", () => { if (pending) output.write(redact(pending)); });
  }
  return proc;
}
async function run(command, args) {
  const proc = spawnSafe(command, args);
  await new Promise((resolvePromise, reject) => {
    proc.once("error", () => reject(new Error("Could not run a required command. Check that Node.js and npm are installed.")));
    proc.once("exit", code => code === 0 ? resolvePromise() : reject(new Error("Setup command failed. See the diagnostic above; the database address is hidden.")));
  });
}
async function npmCi() {
  if (process.platform === "win32") await run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm ci"]);
  else await run("npm", ["ci"]);
}
const pause = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
function openBrowser(url) {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "start", '""', url] : [url];
  const proc = spawn(command, args, { stdio: "ignore", detached: true });
  proc.on("error", () => log(`Open your browser manually: ${url}`));
  proc.unref();
}
function stop() {
  stopping = true;
  log("Stopping Project OS. Your saved data stays in PostgreSQL.");
  cleanup();
  if (child?.pid && child.exitCode === null) {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      killer.on("exit", () => process.exit(0));
      killer.on("error", () => { child.kill(); process.exit(0); });
    } else { child.kill("SIGTERM"); setTimeout(() => process.exit(0), 1000); }
  } else process.exit(0);
}
process.once("SIGINT", stop); process.once("SIGTERM", stop);

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22) fail("Node.js 22 or newer is required. Install Node.js 22 LTS from https://nodejs.org.");
  if ([...flags].some(f => !["--setup", "--check", "--dev"].includes(f))) fail("Supported options: --setup (first run/update), --check (diagnostics), --dev (development). No option means normal launch.");
  if (!existsSync(join(root, ".env"))) {
    if (setup && existsSync(join(root, ".env.example"))) copyFileSync(join(root, ".env.example"), join(root, ".env"));
    fail("Configure DATABASE_URL in .env. Copy .env.example to .env if needed. Use a dedicated Project OS V2 database; do not point setup at an unverified V1 database.");
  }
  if (setup) { log("Installing locked dependencies. Internet access is needed for setup only."); await npmCi(); }
  if (!["next", "dotenv", "pg", "drizzle-orm"].every(name => existsSync(join(root, "node_modules", name, "package.json")))) fail("Dependencies are missing. Run scripts\\start-project-os.cmd --setup once (or npm ci). Do not copy node_modules from another computer.");
  const dotenv = await import("dotenv"); dotenv.config({ path: join(root, ".env"), quiet: true });
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is missing from .env. See the PostgreSQL setup section in README.md.");
  let url;
  try { url = new URL(process.env.DATABASE_URL); } catch { fail("DATABASE_URL is not a valid URL. Correct .env using .env.example as a template."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || /YOUR_USER|YOUR_PASSWORD/.test(process.env.DATABASE_URL)) fail("Replace the placeholders in .env with your PostgreSQL user, password, host, and database name. Encode special password characters as URL escapes.");
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("PORT must be a whole number between 1024 and 65535.");
  process.env.PROJECT_OS_INSTANCE = createHash("sha256").update(root).digest("hex").slice(0, 20);
  const baseUrl = `http://127.0.0.1:${port}`;
  async function health() {
    try { const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1800) }); const data = await res.json(); return res.ok && data.ok && data.app === "project-os" && data.schemaReady && data.instance === process.env.PROJECT_OS_INSTANCE; } catch { return false; }
  }
  if (!setup && !checkOnly && await health()) { log("This Project OS instance is already running. Opening its workspace."); openBrowser(baseUrl); return; }
  const { Pool } = await import("pg"); const { drizzle } = await import("drizzle-orm/node-postgres"); const { sql } = await import("drizzle-orm");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  const db = drizzle(pool);
  let ready = false;
  try {
    await db.execute(sql`select 1`);
    log("PostgreSQL connection: OK. Credentials are not displayed.");
    if (setup) {
      log("Applying the V2 schema to your configured database. Back up existing data before updates.");
      await run(process.execPath, [join(root, "node_modules/drizzle-kit/bin.cjs"), "push"]);
    }
    try {
      await db.execute(sql`select id, revision, data, updated_at from project_os_workspaces limit 0`);
      await db.execute(sql`select id, data, created_at from project_os_backups limit 0`);
      ready = true;
    } catch { /* A missing or outdated schema is reported below, without connection details. */ }
  } catch (e) {
    if (setup && e instanceof Error && e.message.startsWith("Setup command")) throw e;
    fail("Cannot connect to PostgreSQL. Start the PostgreSQL Windows service, then check DATABASE_URL in .env. Confirm that the database exists and the user has access. Run with --check again after fixing it.");
  } finally { await pool.end(); }
  if (!ready) fail("Database schema is missing or outdated. Back up your data, then run scripts\\start-project-os.cmd --setup (or npx drizzle-kit push). Do not use an unverified V1 database.");
  log("Database schema: OK.");
  if (checkOnly) { log(`Environment checks passed. Normal launch opens ${baseUrl}.`); return; }
  if (setup) {
    log("Building the normal-use application. This can take a few minutes on a slower computer.");
    await run(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "build"]);
    log("Setup complete. Next time double-click your Project OS shortcut. To create it, right-click scripts/create-shortcut.ps1 and choose Run with PowerShell (if your local policy allows).");
    return;
  }
  if (!development && !existsSync(join(root, ".next", "BUILD_ID"))) fail("The normal-use build is missing. Run scripts\\start-project-os.cmd --setup once. For development, launch with --dev.");
  mkdirSync(join(root, ".local"), { recursive: true });
  if (existsSync(lockPath)) {
    let running = false;
    try { const pid = Number(readFileSync(lockPath, "utf8")); if (Number.isInteger(pid) && pid > 0) { process.kill(pid, 0); running = true; } } catch {}
    if (running) {
      log("Another launcher is starting this folder. Waiting for readiness…");
      for (let i = 0; i < 60; i++) { if (await health()) { openBrowser(baseUrl); return; } await pause(1000); }
      fail("The other launcher is not ready. Check its window, stop it with Ctrl+C, then retry. Do not delete .local/launch.lock while it is running.");
    }
    try { unlinkSync(lockPath); } catch {}
  }
  try { writeFileSync(lockPath, String(process.pid), { flag: "wx" }); lockOwned = true; } catch { fail("Another launcher just started. Wait a moment, then try again."); }
  const portAvailable = await new Promise(resolvePromise => {
    const tester = net.createServer(); tester.once("error", () => resolvePromise(false)); tester.listen(port, "127.0.0.1", () => tester.close(() => resolvePromise(true)));
  });
  if (!portAvailable) fail(`Port ${port} is in use by another server. Stop it or choose a different PORT in .env. Project OS will not stop unrelated processes.`);
  log(`Starting ${development ? "development" : "normal"} mode at ${baseUrl}…`);
  log("Keep this window open. Closing the browser does not stop Project OS. Press Ctrl+C here to stop it.");
  child = spawnSafe(process.execPath, [join(root, "node_modules/next/dist/bin/next"), development ? "dev" : "start", "--hostname", "127.0.0.1", "--port", String(port)]);
  let exited = false;
  child.once("error", () => { exited = true; log("Server could not start. Run --check for diagnostics."); cleanup(); });
  child.once("exit", code => { exited = true; cleanup(); process.exit(stopping ? 0 : (code ?? 1)); });
  for (let i = 0; i < 120; i++) {
    if (exited) fail("Server exited before becoming ready. Review the diagnostics above.");
    if (await health()) { log("Ready. Opening your workspace."); openBrowser(baseUrl); return; }
    await pause(1000);
  }
  if (child) child.kill();
  fail("Server readiness timed out. Check PostgreSQL, close this launcher, and run --check. Your saved data has not been deleted.");
}
main().catch(error => { cleanup(); console.error(`[Project OS] ${redact(error instanceof Error ? error.message : "Unexpected launch error. Run --check.")}`); process.exitCode = 1; });
