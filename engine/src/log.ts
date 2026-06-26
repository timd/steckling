/**
 * Tiny ANSI logging helpers — no dependency.
 * Colour is disabled when stdout isn't a TTY or NO_COLOR is set.
 */

const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

const wrap =
  (code: string) =>
  (s: string): string =>
    useColor ? `\x1b[${code}m${s}\x1b[0m` : s;

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  cyan: wrap("36"),
};

export const log = {
  ok: (m: string): void => console.log(`${c.green("✓")} ${m}`),
  info: (m: string): void => console.log(`${c.cyan("ℹ")} ${m}`),
  warn: (m: string): void => console.warn(`${c.yellow("⚠")} ${m}`),
  error: (m: string): void => console.error(`${c.red("✗")} ${m}`),
};
