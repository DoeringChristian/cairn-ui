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

const at = (rel: string, text: string, index: number | undefined) => `${rel}:${text.slice(0, index).split("\n").length}`;

test("the gear editor has no section control: cards change section by drag & drop only", () => {
  const editor = sources().find((s) => s.rel === "components/workspace/PanelEditor.tsx")!;
  assert.ok(editor, "PanelEditor.tsx exists");
  const hits = [...editor.text.matchAll(/label="Section"|aria-label="New section name"|moveTo|editor\.sections?\b/g)].map(
    (m) => `${at(editor.rel, editor.text, m.index)}: ${m[0]}`,
  );
  assert.deepEqual(hits, []);
  const actions = sources().find((s) => s.rel === "lib/workspace/panel-actions.ts")!;
  assert.doesNotMatch(actions.text, /moveTo|sections:/, "PanelEditor (the context) offers no section move");
});

test("cards and sections are added from the layout's + only: no dialog, prompt or toolbar builder", () => {
  const files = ["components/WorkspaceToolbar.tsx", "components/workspace/WorkspaceView.tsx", "components/SectionBlock.tsx"];
  const hits = sources()
    .filter(({ rel }) => files.includes(rel))
    .flatMap(({ rel, text }) =>
      [...text.matchAll(/\bprompt\(|Build panels|onAddCards|onAddSection|onBuildPanels|CardBuilder/g)].map((m) => `${at(rel, text, m.index)}: ${m[0]}`),
    );
  assert.deepEqual(hits, []);
});
