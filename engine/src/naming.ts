/**
 * Deterministic per-branch identifiers. Everything is derived from the branch
 * name alone, so the same branch always maps to the same compose project.
 */

import { createHash } from "node:crypto";

export interface BranchNames {
  branch: string;
  /** Hyphenated, lowercased, length-capped slug. */
  slug: string;
  /** 6-char sha1 prefix — disambiguates branches that slugify the same. */
  hash6: string;
  /** Docker Compose project name: `steckling_<slug_with_underscores>_<hash6>`. */
  project: string;
}

export function hash6(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 6);
}

export function slugify(branch: string, cap = 24): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, cap)
    .replace(/-+$/g, "");
}

export function computeNames(branch: string): BranchNames {
  const h = hash6(branch);
  const slug = slugify(branch);
  const project = `steckling_${slug.replace(/-/g, "_") || "branch"}_${h}`;
  return { branch, slug, hash6: h, project };
}
