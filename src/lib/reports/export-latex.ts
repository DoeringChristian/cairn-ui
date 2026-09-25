/**
 * Export a report as a LaTeX zip: `report.tex` (lib/reports/latex.ts),
 * `figures/card-<n>.png` (each card captured from the page) and
 * `assets/<hash>.<ext>` (images uploaded into markdown cells).
 *
 * The caller renders the report under `ReportExportContext = true` (every
 * card expanded) before calling this; `exportReportLatex` waits for the page
 * to settle, captures each card through `renderChartPng`, and returns the zip.
 * Loaded lazily, so remark and the zip writer stay out of the main chunk.
 */

import type { QueryClient } from "@tanstack/react-query";
import { renderChartPng } from "../download";
import { zipStore, type ZipEntry } from "../zip";
import { assetStem, buildLatexDocument, emptyFigures, type LatexFigures } from "./latex";
import { isCardsBlock, type ReportBlock } from "./types";

const SETTLE_LIMIT_MS = 30000;
const POLL_MS = 200;

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every card element under `root`: a card still loading its chunk shows a pulsing placeholder. */
function cardsUnder(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-cairn-card]"));
}

/** A Plotly figure is drawn once it has a full layout (set by the first `afterplot`). */
function plotlyDrawn(el: HTMLElement): boolean {
  return !!(el as HTMLElement & { _fullLayout?: unknown })._fullLayout;
}

/** A cheap fingerprint of what the cards show; unchanged across polls means drawn. */
function signature(root: HTMLElement): string {
  return cardsUnder(root)
    .map((c) => `${c.getElementsByTagName("*").length}:${c.textContent?.length ?? 0}:${c.getElementsByTagName("canvas").length}`)
    .join("|");
}

/**
 * Resolve once every card under `root` has drawn: no query in flight, no
 * lazy card still on its placeholder, every image decoded, every Plotly
 * figure plotted, and the cards unchanged across three polls (a finished
 * fetch often mounts a chart that starts the next one). Gives up after
 * SETTLE_LIMIT_MS and captures what is there.
 */
async function waitForCards(root: HTMLElement, qc: QueryClient): Promise<void> {
  const deadline = performance.now() + SETTLE_LIMIT_MS;
  let calm = 0;
  let last = "";
  while (calm < 3 && performance.now() < deadline) {
    await sleep(POLL_MS);
    const sig = signature(root);
    const ready =
      qc.isFetching() === 0 &&
      !root.querySelector('[data-cairn-card] [class*="animate-pulse"]') &&
      Array.from(root.querySelectorAll("img")).every((img) => img.complete) &&
      Array.from(root.querySelectorAll<HTMLElement>(".js-plotly-plot")).every(plotlyDrawn) &&
      sig === last;
    last = sig;
    calm = ready ? calm + 1 : 0;
  }
  // uPlot draws on the next frame after a resize; let it land.
  await frame();
  await frame();
}

/** The card element in a grid slot (the slot itself, or its draggable wrapper's card). */
function slotCard(slot: Element): HTMLElement | null {
  if (slot.hasAttribute("data-cairn-card")) return slot as HTMLElement;
  return slot.querySelector<HTMLElement>("[data-cairn-card]");
}

/**
 * Card id → card element. A grid tagged `data-report-block` belongs to that
 * block; untagged grids are matched to the cards blocks that have cards, in
 * document order. Within a grid, a card's `data-card-key` wrapper (edit mode)
 * names it; otherwise slots follow the block's card order.
 */
function mapCards(root: HTMLElement, blocks: ReportBlock[]): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  const cardsBlocks = blocks.filter(isCardsBlock).filter((b) => b.cards.length > 0);
  const byId = new Map(cardsBlocks.map((b) => [b.id, b]));
  const grids = Array.from(root.querySelectorAll<HTMLElement>("[data-cairn-grid]"));
  grids.forEach((grid, gi) => {
    const tagged = grid.getAttribute("data-report-block");
    const block = tagged ? byId.get(tagged) : cardsBlocks[gi];
    if (!block) return;
    const slots = Array.from(grid.children);
    slots.forEach((slot, si) => {
      const card = slotCard(slot);
      if (!card) return;
      const key = slot.getAttribute("data-card-key");
      const id = key ?? block.cards[si]?.id;
      if (id) out.set(id, card);
    });
  });
  return out;
}

/** An image's file extension graphicx can read, from its MIME type. */
function extFor(mime: string): "png" | "jpg" | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return null;
}

/** Re-encode an image pdflatex cannot read (GIF, WebP) as PNG. */
async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"),
  );
}

async function assetEntry(reportId: string, hash: string): Promise<ZipEntry> {
  const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/assets/${hash}`);
  if (!res.ok) throw new Error(`asset ${hash}: HTTP ${res.status}`);
  let blob = await res.blob();
  let ext = extFor(blob.type);
  if (!ext) {
    blob = await toPng(blob);
    ext = "png";
  }
  return { name: `${assetStem(hash)}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) };
}

export interface LatexExportResult {
  zip: Blob;
  /** Cards that could not be captured (no chart, image or canvas to render), by title. */
  skipped: string[];
}

/** Capture the report rendered under `root` and pack it as a LaTeX zip. */
export async function exportReportLatex(opts: {
  root: HTMLElement;
  blocks: ReportBlock[];
  reportId: string;
  title: string;
  queryClient: QueryClient;
}): Promise<LatexExportResult> {
  const { root, blocks, reportId, title, queryClient } = opts;
  await waitForCards(root, queryClient);

  const figures: LatexFigures = emptyFigures();
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  const elements = mapCards(root, blocks);
  let n = 0;
  for (const block of blocks) {
    if (!isCardsBlock(block)) continue;
    for (const card of block.cards) {
      const el = elements.get(card.id);
      if (!el) continue;
      const caption = el.querySelector("h3")?.textContent?.trim() || card.type;
      try {
        const png = await renderChartPng(el);
        const path = `figures/card-${++n}.png`;
        entries.push({ name: path, data: new Uint8Array(await png.arrayBuffer()) });
        figures.cards.set(card.id, { path, caption });
      } catch {
        skipped.push(caption);
      }
    }
  }

  const tex = buildLatexDocument(blocks, figures, { title });
  for (const hash of figures.assets) {
    try {
      entries.push(await assetEntry(reportId, hash));
    } catch (err) {
      console.warn("LaTeX export: skipping asset", err);
    }
  }
  entries.unshift({ name: "report.tex", data: new TextEncoder().encode(tex) });
  const bytes = zipStore(entries);
  return { zip: new Blob([bytes as BlobPart], { type: "application/zip" }), skipped };
}
