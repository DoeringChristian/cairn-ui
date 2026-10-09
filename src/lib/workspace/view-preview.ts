/**
 * The schematic a view tile draws (pure): the view's layout resolved like the
 * workspace resolves it for the runs being viewed (`deriveLayout`, so
 * automatic panels appear while the view includes unlisted metrics), each
 * section as its name and a rule, each card as a box on the workspace's
 * 12-column grid, as wide as its width (full, 1/2, 1/3 or 1/4 of the row;
 * lib/cards/card-width.ts), with its card type's icon.
 * Cards wrap to a new row like the grid does (no dense packing). A
 * collapsed section shows just its rule.
 */

import type { CardType } from "../cards/card-spec.ts";
import { GRID_COLUMNS, defaultCardWidth, resolveCardWidth, widthSpan } from "../cards/card-width.ts";
import { kindIcon } from "../viewers/kind.ts";
import type { Panel, WorkspaceDoc } from "./doc.ts";
import { deriveLayout, type MetricInfo, type RenderedSection } from "./layout.ts";

/** The workspace grid's columns (ReorderableCardGrid: `md:grid-cols-12`). */
export const PREVIEW_COLUMNS = GRID_COLUMNS;

export interface PreviewBox {
  id: string;
  type: CardType;
  /** Font Awesome class of the card type's icon. */
  icon: string;
  /** Column the box starts in (0-based). */
  x: number;
  /** Columns it spans (12, 6, 4 or 3). */
  w: number;
}

export interface PreviewSection {
  name: string;
  collapsed: boolean;
  rows: PreviewBox[][];
}

export interface ViewPreview {
  sections: PreviewSection[];
  /** Cards the view shows (collapsed sections included). */
  cards: number;
}

/** Card types that show a kind of data use that kind's icon (lib/viewers/kind.ts). */
const KIND_OF_TYPE: Partial<Record<CardType, Parameters<typeof kindIcon>[0]>> = {
  image: "image",
  figure: "figure",
  audio: "audio",
  video: "video",
  tensor: "tensor",
  text: "text",
  pointcloud: "pointcloud",
  mesh: "mesh",
  boxes3d: "boxes3d",
  volume: "mesh",
  custom: "custom",
  table: "table",
  html: "html",
  markdown: "markdown",
  artifact: "pickle",
};

const OTHER_ICONS: Partial<Record<CardType, string>> = {
  scalar: "fa-chart-line",
  histogram: "fa-chart-column",
  preset: "fa-sliders",
  parallel: "fa-chart-gantt",
  scatter: "fa-braille",
  bar: "fa-chart-bar",
  tile: "fa-hashtag",
  importance: "fa-ranking-star",
  "run-compare": "fa-table-columns",
  "code-diff": "fa-code-compare",
  scalars: "fa-table-list",
  config: "fa-sliders",
};

/** The icon a preview box shows for a card type. */
export function cardTypeIcon(type: CardType): string {
  const kind = KIND_OF_TYPE[type];
  return kind ? kindIcon(kind) : (OTHER_ICONS[type] ?? "fa-square");
}

/** A card's column span: its own width, else its type's default (a stored width that isn't one of the four is ignored). */
export function cardSpan(panel: Pick<Panel, "type" | "settings">): number {
  return widthSpan(resolveCardWidth(panel.settings.width, defaultCardWidth(panel.type)));
}

/** Lay boxes into rows of `PREVIEW_COLUMNS`: a box that does not fit what is left of a row starts the next. */
export function packRows(cards: ReadonlyArray<{ id: string; type: CardType; w: number }>): PreviewBox[][] {
  const rows: PreviewBox[][] = [];
  let row: PreviewBox[] = [];
  let x = 0;
  for (const c of cards) {
    if (x + c.w > PREVIEW_COLUMNS && row.length > 0) {
      rows.push(row);
      row = [];
      x = 0;
    }
    row.push({ id: c.id, type: c.type, icon: cardTypeIcon(c.type), x, w: c.w });
    x += c.w;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** The preview of rendered sections (a `deriveLayout` result). */
export function previewSections(sections: readonly RenderedSection[]): ViewPreview {
  let cards = 0;
  const out = sections.map((s): PreviewSection => {
    cards += s.panels.length;
    return {
      name: s.name,
      collapsed: s.collapsed,
      rows: s.collapsed
        ? []
        : packRows(s.panels.map((p) => ({ id: p.panel.id, type: p.panel.type, w: cardSpan(p.panel) }))),
    };
  });
  return { sections: out, cards };
}

/** A view's preview for the runs being viewed (their metrics). */
export function viewPreview(doc: WorkspaceDoc, metrics: readonly MetricInfo[]): ViewPreview {
  return previewSections(deriveLayout(doc, metrics));
}
