/**
 * `steck init` — bootstrap a repo's Steckling setup without hand-editing YAML.
 *
 * Interactive wizard (via @clack/prompts) that writes a commented `steckling.yml`,
 * optionally generates `compose.steckling.yml` from service presets (or wires up an
 * existing compose file), and adds `.steckling/` to `.gitignore`. `--yes` writes a
 * sensible default non-interactively. Detection (run command, .env files) lives
 * here only as *suggested strings* — the engine itself stays stack-agnostic.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";
import { parse as parseYaml } from "yaml";
import { findConfigPath, loadConfig, formatConfigError } from "./config";
import { portEnvName } from "./env";
import { currentBranch, localBranchExists, repoRoot } from "./git";
import { c, log } from "./log";

/** One expose entry the wizard collected (service → published port → env var → URL). */
interface ExposeAnswer {
  service: string;
  container: number;
  env: string;
  url: string;
}

interface InitAnswers {
  /** Path written to `services.compose` (relative, as typed into the config). */
  composePath: string;
  expose: ExposeAnswer[];
  base: string;
  copyOnCreate: string[];
  run: string;
  port: { env: string; base: number } | null;
  provision: string;
}

/** A ready-made service: its expose entry plus a compose service block. */
interface ServicePreset {
  service: string;
  label: string;
  hint: string;
  container: number;
  env: string;
  url: string;
  compose: string;
  volume?: string;
}

function presetCompose(service: string, body: string): string {
  const portVar = portEnvName(service);
  return body.replaceAll("{portvar}", `\${${portVar}:?host port injected by steckling}`);
}

const PRESETS: ServicePreset[] = [
  {
    service: "postgres",
    label: "Postgres",
    hint: "postgres:16 → DATABASE_URL",
    container: 5432,
    env: "DATABASE_URL",
    url: "postgres://app:app@localhost:{port}/app",
    volume: "pgdata",
    compose: presetCompose(
      "postgres",
      `  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "{portvar}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 2s
      timeout: 3s
      retries: 15`,
    ),
  },
  {
    service: "mysql",
    label: "MySQL",
    hint: "mysql:8 → MYSQL_URL",
    container: 3306,
    env: "MYSQL_URL",
    url: "mysql://app:app@localhost:{port}/app",
    volume: "mysqldata",
    compose: presetCompose(
      "mysql",
      `  mysql:
    image: mysql:8
    environment:
      MYSQL_USER: app
      MYSQL_PASSWORD: app
      MYSQL_ROOT_PASSWORD: app
      MYSQL_DATABASE: app
    ports:
      - "{portvar}:3306"
    volumes:
      - mysqldata:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uapp", "-papp"]
      interval: 2s
      timeout: 3s
      retries: 30`,
    ),
  },
  {
    service: "redis",
    label: "Redis",
    hint: "redis:7 → REDIS_URL",
    container: 6379,
    env: "REDIS_URL",
    url: "redis://localhost:{port}",
    compose: presetCompose(
      "redis",
      `  redis:
    image: redis:7
    ports:
      - "{portvar}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 15`,
    ),
  },
  {
    service: "mongo",
    label: "MongoDB",
    hint: "mongo:7 → MONGO_URL",
    container: 27017,
    env: "MONGO_URL",
    url: "mongodb://localhost:{port}/app",
    volume: "mongodata",
    compose: presetCompose(
      "mongo",
      `  mongo:
    image: mongo:7
    ports:
      - "{portvar}:27017"
    volumes:
      - mongodata:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.runCommand('ping').ok"]
      interval: 2s
      timeout: 5s
      retries: 15`,
    ),
  },
  {
    service: "rabbitmq",
    label: "RabbitMQ",
    hint: "rabbitmq:3 → AMQP_URL",
    container: 5672,
    env: "AMQP_URL",
    url: "amqp://guest:guest@localhost:{port}",
    compose: presetCompose(
      "rabbitmq",
      `  rabbitmq:
    image: rabbitmq:3
    ports:
      - "{portvar}:5672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 5s
      timeout: 5s
      retries: 12`,
    ),
  },
];

const GENERATED_COMPOSE = "compose.steckling.yml";
const EXISTING_COMPOSE_NAMES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

interface DetectedRun {
  cmd: string;
  /** What the suggestion was derived from, so the wizard can say so. */
  source: string;
}

/** Suggest an `app.run` command from what's in the directory — a default, never a requirement. */
export function detectRunCommand(cwd: string): DetectedRun | null {
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const pm = existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))
        ? "bun"
        : existsSync(join(cwd, "pnpm-lock.yaml"))
          ? "pnpm"
          : existsSync(join(cwd, "yarn.lock"))
            ? "yarn"
            : "npm";
      if (pkg.scripts?.["dev"]) return { cmd: `${pm} run dev`, source: "package.json scripts.dev" };
      if (pkg.scripts?.["start"])
        return { cmd: pm === "npm" ? "npm start" : `${pm} run start`, source: "package.json scripts.start" };
    } catch {
      // unreadable package.json — fall through to the other detectors
    }
  }
  if (existsSync(join(cwd, "Cargo.toml"))) return { cmd: "cargo run", source: "Cargo.toml" };
  if (existsSync(join(cwd, "go.mod"))) return { cmd: "go run .", source: "go.mod" };
  if (existsSync(join(cwd, "manage.py")))
    return { cmd: "python manage.py runserver", source: "manage.py" };
  if (existsSync(join(cwd, "Gemfile")) && existsSync(join(cwd, "bin/rails")))
    return { cmd: "bin/rails server", source: "Gemfile" };
  return null;
}

/** `.env*` files present in the repo root — candidates for `worktrees.copyOnCreate`. */
function detectEnvFiles(cwd: string): string[] {
  try {
    return readdirSync(cwd, { withFileTypes: true })
      .filter((e) => e.isFile() && /^\.env(\..+)?$/.test(e.name) && !e.name.endsWith(".example"))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Best guess at the branch new worktrees should fork from. */
async function detectBaseBranch(cwd: string): Promise<string> {
  const root = await repoRoot(cwd);
  if (root) {
    for (const candidate of ["main", "master"]) {
      if (await localBranchExists(root, candidate)) return candidate;
    }
  }
  return (await currentBranch(cwd)) ?? "main";
}

/** A service found in an existing compose file, with its first published/exposed port if any. */
interface ExistingService {
  name: string;
  containerPort: number | null;
}

function parseExistingCompose(path: string): ExistingService[] | null {
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const services = (doc as Record<string, unknown>)["services"];
  if (typeof services !== "object" || services === null) return null;

  return Object.entries(services as Record<string, unknown>).map(([name, svc]) => {
    let containerPort: number | null = null;
    if (typeof svc === "object" && svc !== null) {
      const rec = svc as Record<string, unknown>;
      const first = Array.isArray(rec["ports"]) ? rec["ports"][0] : undefined;
      if (typeof first === "string") {
        // "5432", "8080:5432", "127.0.0.1:8080:5432", possibly with "/tcp"
        const target = first.split(":").pop()?.replace(/\/(tcp|udp)$/, "");
        const n = Number(target);
        if (Number.isInteger(n) && n > 0) containerPort = n;
      } else if (typeof first === "object" && first !== null) {
        const t = (first as Record<string, unknown>)["target"];
        if (typeof t === "number") containerPort = t;
      } else if (Array.isArray(rec["expose"]) && rec["expose"].length > 0) {
        const n = Number(rec["expose"][0]);
        if (Number.isInteger(n) && n > 0) containerPort = n;
      }
    }
    return { name, containerPort };
  });
}

/** Preset whose service name matches (postgres → the postgres preset), for prefilling answers. */
function matchPreset(serviceName: string): ServicePreset | null {
  const lower = serviceName.toLowerCase();
  return (
    PRESETS.find((pr) => lower === pr.service || lower.includes(pr.service)) ??
    (lower.includes("postgis") || lower.includes("pg") || lower.includes("database")
      ? (PRESETS[0] ?? null)
      : null)
  );
}

// ---------------------------------------------------------------------------
// File generation
// ---------------------------------------------------------------------------

/** YAML-safe scalar: JSON string encoding is valid YAML. */
function y(s: string): string {
  return JSON.stringify(s);
}

export function buildStecklingYaml(a: InitAnswers): string {
  const lines: string[] = [
    "# steckling.yml — a worktree + isolated Docker service stack per git branch.",
    "# Full reference: https://github.com/timd/steckling/blob/main/docs/config-reference.md",
    "version: 1",
    "",
    "worktrees:",
    `  dir: "../{repo}-trees" # a git worktree per branch lives here`,
    `  base: ${y(a.base)}`,
  ];
  if (a.copyOnCreate.length > 0) {
    lines.push("  copyOnCreate: # gitignored files copied into each new worktree");
    for (const f of a.copyOnCreate) lines.push(`    - ${y(f)}`);
  }
  lines.push("", "services:", `  compose: ${y(a.composePath)}`);
  if (a.expose.length > 0) {
    lines.push("  expose: # container port → env var → URL your app receives");
    for (const e of a.expose) {
      lines.push(
        `    ${e.service}:`,
        `      container: ${e.container}`,
        `      env: ${e.env}`,
        `      url: ${y(e.url)} # {port} = this branch's allocated host port`,
      );
    }
  }
  lines.push("", "app:", `  run: ${y(a.run)} # runs natively on the host, not in Docker`);
  if (a.port) {
    lines.push("  port: # a free host port for the app itself, injected as this env var", `    env: ${y(a.port.env)}`, `    base: ${a.port.base}`);
  }
  if (a.provision) {
    lines.push("", "hooks:", `  provision: ${y(a.provision)} # runs once, on a branch's first \`steck up\``);
  }
  lines.push(
    "",
    "# To ship a branch's agent to Railway, add `agent:` + `deploy:` blocks —",
    "# see docs/config-reference.md and `steck deploy --dry-run`.",
    "",
  );
  return lines.join("\n");
}

export function buildComposeYaml(presets: ServicePreset[]): string {
  const header = [
    "# Per-branch service stack, run by Steckling as an isolated compose project.",
    "# Host ports come from the STECKLING_PORT_<SERVICE> vars Steckling injects.",
  ];
  if (presets.length === 0) {
    return [...header, "services: {} # add your services here", ""].join("\n");
  }
  const body = ["services:", ...presets.map((pr) => pr.compose)];
  const volumes = presets.flatMap((pr) => (pr.volume ? [`  ${pr.volume}:`] : []));
  if (volumes.length > 0) body.push("", "volumes:", ...volumes);
  return [...header, ...body, ""].join("\n");
}

/** Make sure `.steckling/` is gitignored (created, appended, or already there). */
function ensureGitignore(cwd: string): "created" | "added" | "present" {
  const path = join(cwd, ".gitignore");
  if (!existsSync(path)) {
    writeFileSync(path, ".steckling/\n");
    return "created";
  }
  const content = readFileSync(path, "utf8");
  const present = content
    .split("\n")
    .some((l) => l.trim() === ".steckling/" || l.trim() === ".steckling");
  if (present) return "present";
  writeFileSync(path, `${content}${content.endsWith("\n") || content === "" ? "" : "\n"}.steckling/\n`);
  return "added";
}

// ---------------------------------------------------------------------------
// The wizard
// ---------------------------------------------------------------------------

/** Unwrap a clack result; null means the user hit Esc/Ctrl-C. */
function answered<T>(value: T | symbol): T | null {
  return p.isCancel(value) ? null : (value as T);
}

const CANCELLED = "init cancelled — nothing was written.";

async function runWizard(cwd: string): Promise<InitAnswers | null> {
  p.intro(c.bold("steck init"));

  // -- services -------------------------------------------------------------
  let composePath = `./${GENERATED_COMPOSE}`;
  let generate = true;
  let presets: ServicePreset[] = [];
  const expose: ExposeAnswer[] = [];

  const existingCompose = EXISTING_COMPOSE_NAMES.find((f) => existsSync(join(cwd, f)));
  if (existingCompose) {
    const source = answered(
      await p.select({
        message: "This repo already has a compose file — what should Steckling run per branch?",
        options: [
          {
            value: "generate",
            label: `Generate a fresh ${GENERATED_COMPOSE} (recommended)`,
            hint: "keeps your existing file untouched",
          },
          { value: "existing", label: `Use ./${existingCompose}`, hint: "you'll adapt its ports" },
        ],
      }),
    );
    if (source === null) return null;
    generate = source === "generate";
    if (!generate) composePath = `./${existingCompose}`;
  }

  if (generate) {
    const picked = answered(
      await p.multiselect({
        message: "Which services should each branch get? (space to toggle)",
        options: PRESETS.map((pr) => ({ value: pr.service, label: pr.label, hint: pr.hint })),
        initialValues: ["postgres"],
        required: false,
      }),
    );
    if (picked === null) return null;
    presets = PRESETS.filter((pr) => picked.includes(pr.service));
    for (const pr of presets) {
      expose.push({ service: pr.service, container: pr.container, env: pr.env, url: pr.url });
    }
  } else {
    const found = parseExistingCompose(join(cwd, existingCompose ?? "")) ?? [];
    if (found.length === 0) {
      log.warn(`Could not read services from ${existingCompose} — add \`services.expose\` entries by hand later.`);
    } else {
      const picked = answered(
        await p.multiselect({
          message: "Which services should be published (and injected as env vars) per branch?",
          options: found.map((s) => ({
            value: s.name,
            label: s.name,
            hint: s.containerPort ? `container port ${s.containerPort}` : undefined,
          })),
          initialValues: found.map((s) => s.name),
          required: false,
        }),
      );
      if (picked === null) return null;
      for (const name of picked) {
        const svc = found.find((s) => s.name === name);
        const guess = matchPreset(name);
        const container = answered(
          await p.text({
            message: `${name}: container port to publish`,
            initialValue: String(svc?.containerPort ?? guess?.container ?? ""),
            validate: (v) => (/^\d+$/.test((v ?? "").trim()) ? undefined : "must be a port number"),
          }),
        );
        if (container === null) return null;
        const env = answered(
          await p.text({
            message: `${name}: env var your app reads its URL from`,
            initialValue: guess?.env ?? `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_URL`,
            validate: (v) => (v?.trim() ? undefined : "required"),
          }),
        );
        if (env === null) return null;
        const url = answered(
          await p.text({
            message: `${name}: URL template ({port} = allocated host port)`,
            initialValue: guess?.url ?? "http://localhost:{port}",
            validate: (v) => (v?.includes("{port}") ? undefined : "must contain {port}"),
          }),
        );
        if (url === null) return null;
        expose.push({ service: name, container: Number(container.trim()), env: env.trim(), url: url.trim() });
      }
      if (expose.length > 0) {
        p.note(
          expose
            .map((e) => `${e.service}:  ports: ["\${${portEnvName(e.service)}}:${e.container}"]`)
            .join("\n"),
          `Update ${existingCompose} so each host port uses Steckling's injected var:`,
        );
      }
    }
  }

  // -- app ------------------------------------------------------------------
  const detected = detectRunCommand(cwd);
  const run = answered(
    await p.text({
      message: detected
        ? `Command that starts your app ${c.dim(`— detected from ${detected.source}; Enter to accept, or edit`)}`
        : `Command that starts your app, e.g. ${c.dim('"npm run dev"')} — type it below`,
      initialValue: detected?.cmd ?? "",
      validate: (v) => (v?.trim() ? undefined : "required — this is what `steck up` runs"),
    }),
  );
  if (run === null) return null;

  let port: InitAnswers["port"] = null;
  const wantsPort = answered(
    await p.confirm({
      message: "Should Steckling also allocate the app's own port (injected as an env var)?",
      initialValue: true,
    }),
  );
  if (wantsPort === null) return null;
  if (wantsPort) {
    const envName = answered(
      await p.text({
        message: "Env var the app reads its port from",
        initialValue: "PORT",
        validate: (v) => (v?.trim() ? undefined : "required"),
      }),
    );
    if (envName === null) return null;
    const base = answered(
      await p.text({
        message: "Preferred base port (each branch gets one near it)",
        initialValue: "4000",
        validate: (v) => (/^\d+$/.test((v ?? "").trim()) ? undefined : "must be a number"),
      }),
    );
    if (base === null) return null;
    port = { env: envName.trim(), base: Number(base.trim()) };
  }

  const provision = answered(
    await p.text({
      message: `Provision hook — runs once on a branch's first \`steck up\`, e.g. ${c.dim('"npm run migrate"')} ${c.dim("(Enter to skip)")}`,
      defaultValue: "",
    }),
  );
  if (provision === null) return null;

  // -- worktrees ------------------------------------------------------------
  const base = answered(
    await p.text({
      message: "Base branch new worktrees fork from",
      initialValue: await detectBaseBranch(cwd),
      validate: (v) => (v?.trim() ? undefined : "required"),
    }),
  );
  if (base === null) return null;

  let copyOnCreate: string[] = [];
  const envFiles = detectEnvFiles(cwd);
  if (envFiles.length > 0) {
    const picked = answered(
      await p.multiselect({
        message: "Copy these gitignored files into each new worktree?",
        options: envFiles.map((f) => ({ value: f, label: f })),
        initialValues: envFiles,
        required: false,
      }),
    );
    if (picked === null) return null;
    copyOnCreate = picked;
  }

  return {
    composePath,
    expose,
    base: base.trim(),
    copyOnCreate,
    run: run.trim(),
    port,
    provision: provision.trim(),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function init(opts: { yes: boolean }): Promise<number> {
  const cwd = process.cwd();

  const existing = findConfigPath(cwd);
  if (existing && dirname(existing) === cwd) {
    log.error(`This directory is already configured: ${c.bold(existing)}`);
    log.info("Edit it directly, or delete it and re-run `steck init`.");
    return 1;
  }
  if (existing) {
    log.warn(`A steckling.yml exists further up (${existing}) — this will create a nested root that shadows it here.`);
  }

  if ((await currentBranch(cwd)) === null) {
    log.warn("Not on a named git branch — `steck` commands need one (they key everything off the branch).");
  }

  if (opts.yes || !process.stdin.isTTY) {
    if (!opts.yes) {
      log.error("Not a TTY. Re-run with --yes to write the default setup non-interactively.");
      return 1;
    }
    const postgres = PRESETS[0];
    const answers: InitAnswers = {
      composePath: `./${GENERATED_COMPOSE}`,
      expose: postgres
        ? [{ service: postgres.service, container: postgres.container, env: postgres.env, url: postgres.url }]
        : [],
      base: await detectBaseBranch(cwd),
      copyOnCreate: detectEnvFiles(cwd),
      run: detectRunCommand(cwd)?.cmd ?? "echo 'TODO: set app.run in steckling.yml'",
      port: { env: "PORT", base: 4000 },
      provision: "",
    };
    return writeSetup(cwd, answers, postgres ? [postgres] : []);
  }

  const answers = await runWizard(cwd);
  if (answers === null) {
    p.cancel(CANCELLED);
    return 1;
  }
  const generatedPresets =
    answers.composePath === `./${GENERATED_COMPOSE}`
      ? PRESETS.filter((pr) => answers.expose.some((e) => e.service === pr.service))
      : null;
  const code = await writeSetup(cwd, answers, generatedPresets);
  if (code === 0) p.outro(`Done. Next: ${c.bold("steck doctor")}, then ${c.bold("steck up")}.`);
  return code;
}

/** Write all files, then round-trip the config through the loader as a guarantee. */
async function writeSetup(
  cwd: string,
  answers: InitAnswers,
  generatedPresets: ServicePreset[] | null,
): Promise<number> {
  writeFileSync(join(cwd, "steckling.yml"), buildStecklingYaml(answers));
  log.ok(`Wrote ${c.bold("steckling.yml")}`);

  if (generatedPresets !== null) {
    writeFileSync(join(cwd, GENERATED_COMPOSE), buildComposeYaml(generatedPresets));
    log.ok(`Wrote ${c.bold(GENERATED_COMPOSE)}`);
  }

  const gi = ensureGitignore(cwd);
  if (gi === "created") log.ok("Created .gitignore with `.steckling/`");
  else if (gi === "added") log.ok("Added `.steckling/` to .gitignore");

  const res = await loadConfig(cwd);
  if (!res.ok) {
    log.error("The generated steckling.yml failed validation — this is a `steck init` bug:");
    console.error(formatConfigError(res.error));
    return 1;
  }
  return 0;
}
