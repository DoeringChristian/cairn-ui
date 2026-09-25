/**
 * Drift guard: card files and settings panels build their settings from the
 * palette (`components/settings/palette`), never from raw form controls.
 * Scans `components/**\/{*Card,*SettingsPanel}.tsx` outside
 * `components/settings/` for `<select` and `type="checkbox|range|number"`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = join(SRC, "components");

/**
 * Files that still use raw controls, as of the palette's introduction.
 * THIS LIST MUST ONLY SHRINK, and be empty by the end of phase 2 (every card
 * on the palette). Remove a file here when you migrate it; the test fails on
 * entries that are already clean so the list cannot go stale.
 */
const ALLOWLIST = new Set<string>([
  "components/BarChartCard.tsx",
  "components/ImageCard.tsx",
  "components/ImportanceCard.tsx",
  "components/ScalarTileCard.tsx",
  "components/ScatterPlotCard.tsx",
]);

const RAW_CONTROL = /<select\b|type=\{?\s*["'](?:checkbox|range|number)["']/g;

function scanned(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(COMPONENTS, { recursive: true, encoding: "utf8" })) {
    const rel = `components/${entry.split(sep).join("/")}`;
    if (rel.startsWith("components/settings/")) continue;
    if (!/(?:Card|SettingsPanel)\.tsx$/.test(rel)) continue;
    out.push(rel);
  }
  return out.sort();
}

function offenders(rel: string): string[] {
  const text = readFileSync(join(SRC, rel), "utf8");
  return [...text.matchAll(RAW_CONTROL)].map((m) => {
    const line = text.slice(0, m.index).split("\n").length;
    return `${rel}:${line}: ${m[0]}`;
  });
}

test("the scan finds the card files", () => {
  const files = scanned();
  assert.ok(files.includes("components/ScalarPlotCard.tsx"), relative(SRC, COMPONENTS));
  assert.ok(files.length > 10);
});

test("cards and settings panels use the palette, not raw form controls", () => {
  const hits = scanned()
    .filter((f) => !ALLOWLIST.has(f))
    .flatMap(offenders);
  assert.deepEqual(hits, [], "use components/settings/palette controls instead");
});

test("the allowlist has no stale entries", () => {
  const files = new Set(scanned());
  const stale = [...ALLOWLIST].filter((f) => !files.has(f) || offenders(f).length === 0);
  assert.deepEqual(stale, [], "these files are clean now: remove them from ALLOWLIST");
});
