# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's [private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (the **Security → Report a vulnerability** tab), or contact a maintainer
directly.

We'll acknowledge your report as quickly as we can and keep you updated on the fix.

## Scope

Steckling is a local developer tool that orchestrates git worktrees and Docker Compose projects on
your own machine. Worth keeping in mind:

- `steckling.yml` hooks (`provision`, `app.run`) and `steck exec` run **arbitrary shell commands**
  by design — only run Steckling against repositories you trust.
- The registry lives at `~/.steckling/registry.json`; `.steckling/env` (written into each worktree)
  contains connection strings and is gitignored — don't commit it.

## Supported versions

Steckling is pre-1.0; only the latest release receives fixes.
