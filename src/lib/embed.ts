/**
 * Notebook embeds of whole pages (pure): `/embed/run/<run>?tab=…`,
 * `/embed/workspace/<project>?filter=…` and `/embed/report/<project>/<report>`,
 * the pages of the app without its navigation, for `cairn.Run`'s notebook
 * display, `cairn.ui.workspace` and `cairn.ui.report` (iframes).
 *
 * Pure: runs under `node --test`.
 */

import { parseFilter, type GroupNode } from "./run-filter.ts";

/** The run page's tabs, in order: `id` is the tab's path under the run (`.` = Workspace, the default). */
export const RUN_TABS = [
  { id: ".", key: "workspace", label: "Workspace" },
  { id: "overview", key: "overview", label: "Overview" },
  { id: "system", key: "system", label: "System" },
  { id: "logs", key: "logs", label: "Logs" },
  { id: "files", key: "files", label: "Files" },
  { id: "artifacts", key: "artifacts", label: "Artifacts" },
] as const;

/** The run tab path of a `?tab=` value (`workspace`, `overview`, …), or null for the default / an unknown tab. */
export function embedTabPath(tab: string | null): string | null {
  const t = RUN_TABS.find((x) => x.key === tab?.trim().toLowerCase());
  return t && t.id !== "." ? t.id : null;
}

/**
 * The workspace embed's `?filter=`: a runs-table filter tree as JSON, or an
 * expression (`run.group == "exp-44"`) as the tree's one leaf. Null when
 * absent or empty, or JSON that is not a filter tree.
 */
export function embedFilter(raw: string | null): GroupNode | null {
  const text = raw?.trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
    const tree = parseFilter(value);
    return tree.children.length > 0 ? tree : null;
  }
  return { kind: "group", op: "and", children: [{ kind: "expr", expr: text }] };
}

/** The app page an embed opens ("↗ open in cairn"): the run page (its tab), the workspace, the report. */
export function runPagePath(projectId: string, runId: string, tab?: string | null): string {
  return `/p/${encodeURIComponent(projectId)}/r/${runId}${tab && tab !== "." ? `/${tab}` : ""}`;
}
