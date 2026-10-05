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

test("the card editor has no section control: cards change section by drag & drop only", () => {
  const editor = sources().find((s) => s.rel === "components/workspace/CardEditor.tsx")!;
  assert.ok(editor, "CardEditor.tsx exists");
  const hits = [...editor.text.matchAll(/label="Section"|aria-label="New section name"|moveTo|onMove\b/g)].map(
    (m) => `${at(editor.rel, editor.text, m.index)}: ${m[0]}`,
  );
  assert.deepEqual(hits, []);
  const actions = sources().find((s) => s.rel === "lib/workspace/panel-actions.ts")!;
  assert.doesNotMatch(actions.text, /moveTo|sections:/, "PanelActions (the context) offers no section move");
});

test("the one way to add a card is the ghost card ending a section's grid", () => {
  const all = sources();
  // One editor, hosted by the workspace view, opened for adding from one place.
  const hosts = all.filter(({ text }) => /<CardEditorHost\b/.test(text)).map(({ rel }) => rel);
  assert.deepEqual(hosts, ["components/workspace/WorkspaceView.tsx"]);
  const view = all.find((s) => s.rel === "components/workspace/WorkspaceView.tsx")!;
  const opens = [...view.text.matchAll(/setAdding\(([^)]*)\)|onAdd=\{setAdding\}/g)].map((m) => m[0]);
  assert.deepEqual(opens.filter((o) => o !== "setAdding(null)"), ["onAdd={setAdding}"], "only the ghost card opens the editor for adding");
  assert.match(view.text, /<AddCardTile section=\{section\.name\} onAdd=\{setAdding\} \/>/);
  // No other add affordance: section header, toolbar, Manage cards, prompts, the old builder and add modal.
  const files = ["components/WorkspaceToolbar.tsx", "components/workspace/WorkspaceView.tsx", "components/SectionBlock.tsx", "components/workspace/ManageCards.tsx"];
  const hits = all
    .filter(({ rel }) => files.includes(rel))
    .flatMap(({ rel, text }) =>
      [...text.matchAll(/\bprompt\(|Build panels|onAddCards|onAddSection|onBuildPanels|onAddPanel|section-add-panel|CardBuilder|AddCardsModal|>\s*Add cards\s*</g)].map(
        (m) => `${at(rel, text, m.index)}: ${m[0]}`,
      ),
    );
  assert.deepEqual(hits, []);
});

// --- one card editor ---------------------------------------------------------------

const users = (re: RegExp) => sources().filter(({ text }) => re.test(text)).map(({ rel }) => rel).sort();

test("adding and editing render the same CardEditor; no separate add modal or panel editor", () => {
  const rels = sources().map((s) => s.rel);
  for (const gone of ["components/workspace/AddCardsModal.tsx", "components/workspace/PanelEditor.tsx", "lib/workspace/add-cards.ts"]) {
    assert.ok(!rels.includes(gone), `${gone} is gone`);
  }
  const editor = sources().find((s) => s.rel === "components/workspace/CardEditor.tsx")!;
  // One <CardEditor>, in the host, for both modes.
  assert.equal([...editor.text.matchAll(/<CardEditor\b/g)].length, 1);
  assert.match(editor.text, /type EditorMode = "new" \| "pending" \| "edit"/);
  // The workspace card's gear opens it (CardShell portals into its slots); nothing else opens a detail modal for a workspace card.
  assert.deepEqual(users(/<CardEditorSlots\b/), ["components/CardShell.tsx"]);
  assert.deepEqual(users(/<CardDetailModal\b/), ["components/CardShell.tsx", "components/workspace/CardEditor.tsx"]);
  // No hand-over hacks between two modals.
  assert.deepEqual(users(/MutationObserver|flushSync/).filter((r) => r.startsWith("components/workspace/")), []);
  assert.deepEqual(users(/SettingsDataExtraContext|openNextSettingsOn|takePendingSettingsTab/), []);
});

test("exactly one data picker and one type picker", () => {
  // The series catalogue, regex matches and capture groups are shown by CardDataPicker only.
  assert.deepEqual(users(/\bseriesCatalogue\(|\bregexMatches\(|\bcaptureGroups\(/).filter((r) => !r.startsWith("lib/")), ["components/workspace/CardDataPicker.tsx"]);
  assert.deepEqual(users(/<CardDataPicker\b/), ["components/workspace/CardEditor.tsx"]);
  // The compatible card types are listed by CardTypePicker (list + tiles) only, for the editor.
  assert.deepEqual(users(/\bcompatibleTypes\(/).filter((r) => !r.startsWith("lib/")), ["components/workspace/CardEditor.tsx"]);
  assert.deepEqual(users(/<CardTypePicker\b|<CardTypeTiles\b/), ["components/workspace/CardEditor.tsx"]);
  assert.deepEqual(users(/data-testid="card-type"|data-type-preview=/), ["components/workspace/CardTypePicker.tsx"]);
});

test("no second series picker in a workspace card's settings", () => {
  const all = sources();
  // The scalar card's Metrics picker shows only when the card may pick its series (not in a workspace).
  const panel = all.find((s) => s.rel === "components/settings-panels/ScalarSettingsPanel.tsx")!;
  assert.match(panel.text, /\{card && ctx\?\.onChosenChange && \(\s*<SettingsSection name="Series">\s*<FieldMultiPicker/);
  const card = all.find((s) => s.rel === "components/ScalarPlotCard.tsx")!;
  assert.match(card.text, /onChosenChange: panelSeries \? undefined : onChosenChange/);
  // In a workspace the series are the panel's: settings.metrics is not read, chips do not remove, drops are refused.
  const series = all.find((s) => s.rel === "components/card-kit/use-card-series.ts")!;
  assert.match(series.text, /const panelSeries = useWorkspaceRef\(\) != null;/);
  assert.match(series.text, /if \(!panelSeries\) \{\s*const propsTagNames/);
  assert.match(all.find((s) => s.rel === "components/SeriesChipStrip.tsx")!.text, /const removable = useWorkspaceRef\(\) == null;/);
  assert.match(all.find((s) => s.rel === "lib/use-series-drop.ts")!.text, /const accepts = useWorkspaceRef\(\) == null;/);
  // Every other multi-value picker of a settings panel picks something else than the card's series.
  const pickers = all
    .filter(({ rel }) => rel.startsWith("components/settings-panels/"))
    .flatMap(({ rel, text }) => [...text.matchAll(/<FieldMultiPicker\s+label="([^"]+)"/g)].map((m) => `${rel.split("/").pop()}: ${m[1]}`))
    .sort();
  assert.deepEqual(pickers, [
    "RunCompareSettingsPanel.tsx: Pinned keys",
    "ScalarSettingsPanel.tsx: Metrics",
    "ScatterSettingsPanel.tsx: Tooltip fields",
    "TableSettingsPanel.tsx: Group by",
  ]);
});
