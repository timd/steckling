/**
 * Loads and validates `steckling.yml` — the entire per-repo configuration surface.
 * The engine stays stack-blind: everything language-specific lives in strings
 * (the `run` command, the `provision`/`teardown` hooks).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** One service whose container port is published to the host and injected as an env var. */
export const ExposeEntrySchema = z
  .object({
    container: z.number().int().positive(),
    env: z.string().min(1),
    url: z
      .string()
      .min(1)
      .refine((s) => s.includes("{port}"), {
        message: "url must contain the {port} placeholder",
      }),
  })
  .strict();

export const StecklingConfigSchema = z
  .object({
    version: z.literal(1),
    worktrees: z
      .object({
        dir: z.string().min(1).default("../{repo}-trees"),
        base: z.string().min(1).default("main"),
        copyOnCreate: z.array(z.string()).default([]),
      })
      .strict()
      .default({}),
    services: z
      .object({
        compose: z.string().min(1),
        expose: z.record(z.string(), ExposeEntrySchema).default({}),
      })
      .strict(),
    env: z
      .object({
        mode: z.enum(["dotenv", "exec"]).default("dotenv"),
        extra: z.record(z.string(), z.coerce.string()).default({}),
      })
      .strict()
      .default({}),
    app: z
      .object({
        run: z.string().min(1),
        port: z
          .object({
            env: z.string().min(1),
            base: z.number().int().positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    hooks: z
      .object({
        provision: z.string().default(""),
        teardown: z.string().default(""),
      })
      .strict()
      .default({}),
  })
  .strict();

export type StecklingConfig = z.infer<typeof StecklingConfigSchema>;

export type LoadError =
  | { kind: "not-found"; searchedFrom: string }
  | { kind: "parse"; message: string; path: string }
  | { kind: "validation"; issues: z.ZodIssue[]; path: string };

export type LoadResult =
  | { ok: true; config: StecklingConfig; path: string }
  | { ok: false; error: LoadError };

const FILENAMES = ["steckling.yml", "steckling.yaml"];

/** Walk up from `startDir` looking for steckling.yml / steckling.yaml. */
export function findConfigPath(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  for (;;) {
    for (const name of FILENAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function loadConfig(startDir: string = process.cwd()): Promise<LoadResult> {
  const path = findConfigPath(startDir);
  if (!path) {
    return { ok: false, error: { kind: "not-found", searchedFrom: resolve(startDir) } };
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, error: { kind: "parse", message: (e as Error).message, path } };
  }

  const parsed = StecklingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { kind: "validation", issues: parsed.error.issues, path } };
  }
  return { ok: true, config: parsed.data, path };
}

/** Human-readable rendering of a load failure. */
export function formatConfigError(error: LoadError): string {
  switch (error.kind) {
    case "not-found":
      return `No steckling.yml found (searched ${error.searchedFrom} and parent directories).`;
    case "parse":
      return `Could not parse ${error.path}:\n  ${error.message}`;
    case "validation":
      return error.issues
        .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
  }
}
