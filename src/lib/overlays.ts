/**
 * Image overlay annotations (bounding boxes + segmentation masks), as the
 * SDK stores them in an image artifact's metadata (cairn
 * `sdk/handlers/image.py`):
 * - `boxes`: `[{position: {minX, minY, maxX, maxY}, domain: "pixel"|"fraction",
 *   class_id, label, score}]`;
 * - `masks`: `{name: {png_b64, class_labels?}}`, each a grayscale PNG whose
 *   pixel value is the class id (0 = background);
 * - `class_labels`: `{id: name}` (with boxes; masks carry their own copy).
 * Pure helpers only; the drawing lives in components/image/ImageOverlay.tsx.
 */

import { categoryRgb } from "./palette.ts";

export interface OverlayBox {
  position: { minX: number; minY: number; maxX: number; maxY: number };
  domain: "pixel" | "fraction";
  class_id: number;
  label: string | null;
  score: number | null;
}

export interface OverlayMask {
  name: string;
  pngB64: string;
}

export interface ImageOverlays {
  boxes: OverlayBox[];
  masks: OverlayMask[];
  /** Class id (as a string key) → name, merged from boxes' and masks' maps. */
  classLabels: Record<string, string>;
}

/** What the viewer draws; the card's overlay settings. */
export interface OverlayView {
  showBoxes: boolean;
  showMasks: boolean;
  /** 0..1 */
  maskOpacity: number;
  /** Boxes scoring below this are hidden; boxes without a score always show. */
  minScore: number;
  hiddenClasses: number[];
}

export interface OverlayClass {
  id: number;
  name: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseLabels(v: unknown, into: Record<string, string>): void {
  if (!isObj(v)) return;
  for (const [k, name] of Object.entries(v)) if (typeof name === "string") into[k] = name;
}

function parseBox(v: unknown): OverlayBox | null {
  if (!isObj(v) || !isObj(v.position)) return null;
  const p = v.position;
  const minX = num(p.minX), minY = num(p.minY), maxX = num(p.maxX), maxY = num(p.maxY);
  if (minX == null || minY == null || maxX == null || maxY == null) return null;
  return {
    position: { minX, minY, maxX, maxY },
    domain: v.domain === "pixel" ? "pixel" : "fraction",
    class_id: num(v.class_id) ?? 0,
    label: typeof v.label === "string" ? v.label : null,
    score: num(v.score),
  };
}

/** The overlays in an image's metadata, or null when it carries none. */
export function parseOverlays(metadata: Record<string, unknown> | null | undefined): ImageOverlays | null {
  if (!metadata) return null;
  const classLabels: Record<string, string> = {};
  parseLabels(metadata.class_labels, classLabels);
  const boxes = Array.isArray(metadata.boxes)
    ? metadata.boxes.map(parseBox).filter((b): b is OverlayBox => b !== null)
    : [];
  const masks: OverlayMask[] = [];
  if (isObj(metadata.masks)) {
    for (const [name, m] of Object.entries(metadata.masks)) {
      if (!isObj(m) || typeof m.png_b64 !== "string") continue;
      masks.push({ name, pngB64: m.png_b64 });
      parseLabels(m.class_labels, classLabels);
    }
  }
  if (boxes.length === 0 && masks.length === 0) return null;
  return { boxes, masks, classLabels };
}

/** A box in image pixels (the overlay's viewBox units) for an image of `w`×`h`. */
export function boxToRect(box: OverlayBox, w: number, h: number): { x: number; y: number; width: number; height: number } {
  const sx = box.domain === "fraction" ? w : 1;
  const sy = box.domain === "fraction" ? h : 1;
  const x0 = Math.min(box.position.minX, box.position.maxX) * sx;
  const x1 = Math.max(box.position.minX, box.position.maxX) * sx;
  const y0 = Math.min(box.position.minY, box.position.maxY) * sy;
  const y1 = Math.max(box.position.minY, box.position.maxY) * sy;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The class's display name: its `class_labels` entry, else `class <id>`. */
export function className(id: number, labels: Record<string, string>): string {
  return labels[String(id)] ?? `class ${id}`;
}

/** A box's caption: its own label (else its class name) and score. */
export function boxCaption(box: OverlayBox, labels: Record<string, string>): string {
  const name = box.label ?? className(box.class_id, labels);
  return box.score == null ? name : `${name} ${box.score.toFixed(2)}`;
}

/** The boxes to draw under `view` (score threshold + hidden classes). */
export function visibleBoxes(boxes: OverlayBox[], view: Pick<OverlayView, "minScore" | "hiddenClasses">): OverlayBox[] {
  const hidden = new Set(view.hiddenClasses);
  return boxes.filter((b) => !hidden.has(b.class_id) && (b.score == null || b.score >= view.minScore));
}

/** `#rrggbb` for a class id — the same colour in boxes, masks and the legend. */
export function classColor(id: number): string {
  return `#${categoryRgb(id).toString(16).padStart(6, "0")}`;
}

/**
 * Class id → RGBA lookup (256 × 4 bytes) for colourising a mask: the palette
 * colour at full alpha, and alpha 0 for the background (id 0) and hidden
 * classes. Opacity is applied when drawing, so it needs no new LUT.
 */
export function maskLut(hiddenClasses: number[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const hidden = new Set(hiddenClasses);
  for (let id = 1; id < 256; id++) {
    if (hidden.has(id)) continue;
    const c = categoryRgb(id);
    lut[id * 4] = (c >> 16) & 255;
    lut[id * 4 + 1] = (c >> 8) & 255;
    lut[id * 4 + 2] = c & 255;
    lut[id * 4 + 3] = 255;
  }
  return lut;
}

/** Colourise a decoded mask (one class id per pixel) to RGBA through `lut`. */
export function colorizeMask(mask: Uint8Array, lut: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const o = mask[i]! * 4;
    const p = i * 4;
    out[p] = lut[o]!;
    out[p + 1] = lut[o + 1]!;
    out[p + 2] = lut[o + 2]!;
    out[p + 3] = lut[o + 3]!;
  }
  return out;
}

/** The distinct class ids present in a decoded mask, background excluded. */
export function maskClassIds(mask: Uint8Array): number[] {
  const seen = new Uint8Array(256);
  for (let i = 0; i < mask.length; i++) seen[mask[i]!] = 1;
  const ids: number[] = [];
  for (let id = 1; id < 256; id++) if (seen[id]) ids.push(id);
  return ids;
}

/**
 * The classes a set of overlays refers to, sorted by id: every box's class,
 * every labelled class, and any extra ids (e.g. found in decoded masks).
 */
export function collectClasses(overlays: Array<ImageOverlays | null>, extraIds: number[] = []): OverlayClass[] {
  const labels: Record<string, string> = {};
  const ids = new Set<number>(extraIds);
  for (const o of overlays) {
    if (!o) continue;
    Object.assign(labels, o.classLabels);
    for (const k of Object.keys(o.classLabels)) {
      const id = Number(k);
      if (Number.isInteger(id) && (id !== 0 || o.boxes.some((b) => b.class_id === 0))) ids.add(id);
    }
    for (const b of o.boxes) ids.add(b.class_id);
  }
  return [...ids].sort((a, b) => a - b).map((id) => ({ id, name: className(id, labels) }));
}

/** What a pane's images carry, reported up to the card for its settings. */
export interface OverlaySummary {
  classes: OverlayClass[];
  hasBoxes: boolean;
  hasMasks: boolean;
  /** Any box carries a score (the min-score slider only matters then). */
  hasScores: boolean;
}

export const EMPTY_OVERLAY_SUMMARY: OverlaySummary = { classes: [], hasBoxes: false, hasMasks: false, hasScores: false };

export function summarizeOverlays(overlays: Array<ImageOverlays | null>, maskIds: number[] = []): OverlaySummary {
  const present = overlays.filter((o): o is ImageOverlays => o !== null);
  return {
    classes: collectClasses(present, maskIds),
    hasBoxes: present.some((o) => o.boxes.length > 0),
    hasMasks: present.some((o) => o.masks.length > 0),
    hasScores: present.some((o) => o.boxes.some((b) => b.score != null)),
  };
}

/** Merge per-pane summaries into one (classes deduped by id, first name wins). */
export function mergeOverlaySummaries(summaries: OverlaySummary[]): OverlaySummary {
  const byId = new Map<number, OverlayClass>();
  for (const s of summaries) for (const c of s.classes) if (!byId.has(c.id)) byId.set(c.id, c);
  return {
    classes: [...byId.values()].sort((a, b) => a.id - b.id),
    hasBoxes: summaries.some((s) => s.hasBoxes),
    hasMasks: summaries.some((s) => s.hasMasks),
    hasScores: summaries.some((s) => s.hasScores),
  };
}
