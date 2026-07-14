/** Unit tests for branch → slug/hash/project naming. Run with `bun test`. */
import { expect, test } from "bun:test";
import { computeNames, hash6, slugify } from "../src/naming";

test("slugify lowercases, hyphenates, and trims", () => {
  expect(slugify("feat/PLA-123_login")).toBe("feat-pla-123-login");
  expect(slugify("--weird--branch--")).toBe("weird-branch");
  expect(slugify("UPPER")).toBe("upper");
});

test("slugify caps length without a trailing hyphen", () => {
  const slug = slugify("a".repeat(20) + "-" + "b".repeat(20));
  expect(slug.length).toBeLessThanOrEqual(24);
  expect(slug.endsWith("-")).toBe(false);
});

test("hash6 is stable and 6 hex chars", () => {
  expect(hash6("main")).toBe(hash6("main"));
  expect(hash6("main")).toMatch(/^[0-9a-f]{6}$/);
  expect(hash6("main")).not.toBe(hash6("main2"));
});

test("computeNames produces a compose-safe project name", () => {
  const n = computeNames("feat/a");
  expect(n.project).toBe(`steckling_feat_a_${n.hash6}`);
  expect(n.project).toMatch(/^[a-z0-9_]+$/);
});

test("same branch always maps to the same project", () => {
  expect(computeNames("feat/x").project).toBe(computeNames("feat/x").project);
});

test("branches that slugify identically stay distinct via the hash", () => {
  const a = computeNames("feat/a!");
  const b = computeNames("feat/a?");
  expect(a.slug).toBe(b.slug);
  expect(a.project).not.toBe(b.project);
});

test("a branch with no slug-safe chars still gets a valid project", () => {
  const n = computeNames("日本語");
  expect(n.project).toBe(`steckling_branch_${n.hash6}`);
});
