/**
 * The runs table's search box: a case-insensitive regex over a run's name,
 * id, status and tags. An invalid regex matches everything and reports its
 * error (the box shows it).
 */

import type { Run } from "../../api/types.ts";
import { parseTags } from "./context.ts";

export interface RunSearch {
  regex: RegExp | null;
  error: string | null;
}

export function compileRunSearch(raw: string): RunSearch {
  const s = raw.trim();
  if (!s) return { regex: null, error: null };
  try {
    return { regex: new RegExp(s, "i"), error: null };
  } catch {
    return { regex: null, error: "invalid regex" };
  }
}

export function matchesRunSearch(run: Pick<Run, "id" | "display_name" | "status" | "tags">, search: RunSearch): boolean {
  if (!search.regex) return true;
  return search.regex.test(`${run.display_name ?? ""} ${run.id} ${run.status} ${parseTags(run.tags).join(" ")}`);
}
