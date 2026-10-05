/**
 * Drift guard for "the gear is the one editor of a card":
 * - no "Edit card" action anywhere (the builder has no edit mode);
 * - every card component gives its CardShell a Settings action (the gear),
 *   including the empty-panel card and the single value.
 * Run: `npm run test:unit`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  for (const entry of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
    const rel = entry.split(sep).join("/");
    if (!/\.(ts|tsx)$/.test(rel) || /\.test\.ts$/.test(rel)) continue;
    out.push({ rel, text: readFileSync(join(SRC, rel), "utf8") });
  }
  return out;
}

test('no "Edit card" action and no builder edit mode', () => {
  const hits = sources().flatMap(({ rel, text }) =>
    [...text.matchAll(/Edit card|kind: "edit"|onEditPanel/g)].map((m) => `${rel}:${text.slice(0, m.index).split("\n").length}: ${m[0]}`),
  );
  assert.deepEqual(hits, []);
});

test("every CardShell gets a Settings action", () => {
  const missing = sources()
    .filter(({ rel, text }) => rel !== "components/CardShell.tsx" && /<CardShell\b/.test(text) && !/\bonSettings=\{/.test(text))
    .map(({ rel }) => rel);
  assert.deepEqual(missing, []);
});
