/**
 * `steck doctor` — verify the environment can actually run Steckling:
 * git + a reachable docker daemon + docker compose, plus a sanity check of
 * steckling.yml if one is present.
 */

import { loadConfig, formatConfigError } from "./config";
import { c, log } from "./log";
import { run, which } from "./sh";

type Status = "ok" | "warn" | "fail";

interface Check {
  name: string;
  status: Status;
  detail: string;
}

async function checkGit(): Promise<Check> {
  if (!which("git")) return { name: "git", status: "fail", detail: "not found on PATH" };
  const r = await run(["git", "--version"]);
  return {
    name: "git",
    status: r.ok ? "ok" : "fail",
    detail: r.ok ? r.stdout.replace("git version ", "") : "`git --version` failed",
  };
}

async function checkDocker(): Promise<Check[]> {
  if (!which("docker")) {
    return [
      { name: "docker", status: "fail", detail: "not found on PATH" },
      { name: "docker compose", status: "fail", detail: "unavailable (docker missing)" },
    ];
  }

  const ver = await run(["docker", "version", "--format", "{{.Server.Version}}"]);
  const daemon: Check =
    ver.ok && ver.stdout
      ? { name: "docker daemon", status: "ok", detail: `server v${ver.stdout}` }
      : {
          name: "docker daemon",
          status: "fail",
          detail: "docker found but the daemon isn't reachable — is Docker running?",
        };

  const comp = await run(["docker", "compose", "version", "--short"]);
  const compose: Check = comp.ok
    ? { name: "docker compose", status: "ok", detail: `v${comp.stdout}` }
    : { name: "docker compose", status: "fail", detail: "`docker compose` plugin not available" };

  return [daemon, compose];
}

async function checkMprocs(): Promise<Check> {
  if (!which("mprocs")) {
    return {
      name: "mprocs",
      status: "warn",
      detail: "not found — only needed for `steck tree` (brew install mprocs)",
    };
  }
  const r = await run(["mprocs", "--version"]);
  return {
    name: "mprocs",
    status: "ok",
    detail: r.ok ? r.stdout.split("\n")[0] ?? "installed" : "installed",
  };
}

async function checkRailway(): Promise<Check> {
  if (!which("railway")) {
    return {
      name: "railway",
      status: "warn",
      detail: "not found — only needed for `steck deploy` (docs.railway.com/cli)",
    };
  }
  const r = await run(["railway", "whoami"]);
  return r.ok
    ? { name: "railway", status: "ok", detail: r.stdout.split("\n")[0] ?? "authenticated" }
    : { name: "railway", status: "warn", detail: "installed but not logged in — `railway login` or set RAILWAY_TOKEN" };
}

async function checkConfig(): Promise<Check> {
  const res = await loadConfig();
  if (res.ok) {
    const n = Object.keys(res.config.services.expose).length;
    return {
      name: "steckling.yml",
      status: "ok",
      detail: `${res.path} (${n} exposed service${n === 1 ? "" : "s"})`,
    };
  }
  if (res.error.kind === "not-found") {
    return {
      name: "steckling.yml",
      status: "warn",
      detail: "none found yet (fine if you haven't set one up)",
    };
  }
  return { name: "steckling.yml", status: "fail", detail: formatConfigError(res.error) };
}

export async function runDoctor(): Promise<number> {
  const checks: Check[] = [];
  checks.push({ name: "bun", status: "ok", detail: `v${Bun.version}` });
  checks.push(await checkGit());
  checks.push(...(await checkDocker()));
  checks.push(await checkMprocs());
  checks.push(await checkRailway());
  checks.push(await checkConfig());

  const icon = (s: Status): string =>
    s === "ok" ? c.green("✓") : s === "warn" ? c.yellow("⚠") : c.red("✗");

  console.log(c.bold("\nsteck doctor\n"));
  for (const ch of checks) {
    const lines = ch.detail.split("\n");
    console.log(`  ${icon(ch.status)} ${ch.name.padEnd(16)} ${c.dim(lines[0] ?? "")}`);
    for (const extra of lines.slice(1)) console.log(`    ${c.dim(extra)}`);
  }
  console.log("");

  const failed = checks.filter((ch) => ch.status === "fail");
  if (failed.length === 0) {
    log.ok("Environment looks good.");
    return 0;
  }
  log.error(`${failed.length} check(s) failed — fix the ✗ items above.`);
  return 1;
}
