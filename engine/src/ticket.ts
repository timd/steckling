/**
 * Ticket identity derived from the branch name. Vendor-blind: the engine only
 * carries the ID (and an optional URL rendered from a template) — it never
 * talks to a ticketing service. Opt-in: no `ticket:` block, no parsing.
 */

import type { StecklingConfig } from "./config";

/** Default env var name for the ticket ID (overridable via `ticket.env`). */
export const TICKET_ENV_DEFAULT = "STECKLING_TICKET";

/**
 * First match of `ticket.pattern` against the branch name, or null.
 * Matching is case-insensitive (ticket IDs are, in every tracker); the match
 * is returned verbatim — no case transform.
 */
export function parseTicket(config: StecklingConfig, branch: string): string | null {
  const pattern = config.ticket?.pattern;
  if (!pattern) return null;
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    return null; // config validation rejects bad patterns; belt-and-braces
  }
  return branch.match(re)?.[0] ?? null;
}

/** Render `ticket.url` for a ticket ID, or null if no template is configured. */
export function ticketUrl(config: StecklingConfig, ticket: string): string | null {
  const template = config.ticket?.url;
  return template ? template.replaceAll("{ticket}", ticket) : null;
}

/** The env var name the ticket ID is injected under. */
export function ticketEnvName(config: StecklingConfig): string {
  return config.ticket?.env ?? TICKET_ENV_DEFAULT;
}
