/**
 * Drift guard for the card header: right of its bar, every card shows the
 * same shared actions (components/card-header/CardHeaderActions.tsx) in one
 * order — screenshot, download, add to report, reset view, settings,
 * duplicate, remove — four on read-only cards; and no card renders its own
 * copies of them. Run: `npm run test:unit`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

function sources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  for (const entry of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
    const rel = entry.split(sep).join("/");
    if (!/\.(ts|tsx)$/.test(rel) || /\.test\.ts$/.test(rel)) continue;
    out.push({ rel, text: readFileSync(join(SRC, rel), "utf8") });
  }
  return out;
}

test("the shared actions: exactly these seven, in this order", () => {
  const text = read("components/card-header/CardHeaderActions.tsx");
  const keys = [...text.matchAll(/\{ key: "(\w+)", icon: "([\w-]+)", label: "([^"]+)" \}/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
  assert.deepEqual(keys, [
    "onScreenshot fa-camera Screenshot",
    "onDownload fa-download Download data",
    "addToReport fa-file-circle-plus Add to report",
    "onResetView fa-rotate-left Reset view",
    "onSettings fa-gear Settings",
    "onDuplicate fa-clone Duplicate card",
    "onRemove fa-xmark Remove card",
  ]);
  assert.match(read("components/AddToReportButton.tsx"), /className="fa-solid fa-file-circle-plus"/);
});

test("every card header renders them right of its bar; read-only cards keep screenshot, download, reset view, settings", () => {
  const header = read("components/CardHeader.tsx");
  assert.match(header, /<div className="border-l border-border pl-1\.5">\s*<CardHeaderActions actions=\{actions\}/);
  assert.match(
    header,
    /: \{ onScreenshot: actionsProp\.onScreenshot, onDownload: actionsProp\.onDownload, onResetView: actionsProp\.onResetView, onSettings: actionsProp\.onSettings \};/,
  );
  // CardShell always supplies all seven, with working defaults for screenshot, download and reset.
  const shell = read("components/CardShell.tsx");
  const block = /actions=\{\{([\s\S]*?)\}\}\s*cardActions=/.exec(shell)?.[1] ?? "";
  const order = [...block.matchAll(/^\s{12}(\w+)[:,]/gm)].map((m) => m[1]);
  assert.deepEqual(order, ["onScreenshot", "onDownload", "addToReport", "onResetView", "onSettings", "onDuplicate", "onRemove"]);
  assert.match(block, /downloadCardPng\(cardRef\.current/);
  assert.match(block, /onDownload \?\?\s*\(\(\) => \{\s*if \(cardRef\.current\) void downloadCardArtifacts/);
  assert.match(block, /resetPlotlyViews\(cardRef\.current\)/);
  // Every card's settings: CardShell is the only header.
  const headers = sources().filter(({ text }) => /<CardHeader\b/.test(text)).map(({ rel }) => rel).sort();
  assert.deepEqual(headers, ["components/CardShell.tsx", "pages/UiGalleryPage.tsx"]);
});

test("no card renders its own copies of the shared actions", () => {
  const allowed = new Set([
    "components/card-header/CardHeaderActions.tsx",
    "components/CardHeader.tsx",
    "components/CardShell.tsx",
    "components/AddToReportButton.tsx",
    "pages/UiGalleryPage.tsx",
    // A standalone viewer's corner controls (the artifact explorer): not in a card.
    "components/viewers/ViewerToolbar.tsx",
  ]);
  const hits = sources()
    .filter(({ rel }) => !allowed.has(rel))
    .flatMap(({ rel, text }) =>
      [
        ...text.matchAll(
          /<AddToReportButton\b|\b(?:onScreenshot|addToReportSlot|viewModified)=\{|aria-label="(?:Screenshot|Download data|Reset view|Duplicate card|Remove card|Add to report)"/g,
        ),
      ].map((m) => `${rel}: ${m[0]}`),
    );
  assert.deepEqual(hits, []);
});

test("the screenshot is the card as displayed: one faithful clone at the device pixel ratio, no composited layers", () => {
  const cap = read("lib/card-capture.ts");
  assert.match(cap, /export async function captureCardPng\(card: HTMLElement, scale = window\.devicePixelRatio \|\| 1\)/);
  const body = cap.slice(cap.indexOf("export async function captureCardPng"));
  assert.match(body, /await faithfulClone\(card\)/);
  assert.doesNotMatch(body.slice(0, body.indexOf("\n}\n")), /collectLayers/);
  // What an SVG picture cannot draw is replaced in place by what the page shows now.
  for (const re of [/o instanceof HTMLCanvasElement\) return replaceWith\(canvasUrl\(o\)\)/, /o instanceof HTMLVideoElement\) return replaceWith\(mediaUrl\(o\)\)/, /getComputedStyle\(o, which\)/, /scrolled\.push/, /embeddedFonts\(families\)/]) {
    assert.match(cap, re);
  }
});
