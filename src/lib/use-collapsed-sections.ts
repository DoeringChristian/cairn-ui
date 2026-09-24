import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson, storageKeys } from "./storage";

function loadCollapsed(scope: string): Set<string> {
  const raw = loadJson<string[]>(localStorage, storageKeys.collapsedSections(scope));
  return new Set(Array.isArray(raw) ? raw : []);
}

/**
 * Which card sections are collapsed, persisted in localStorage per `scope`
 * (a run id, or a comparison's `compareRunId`). Reloads when `scope` changes.
 */
export function useCollapsedSections(scope: string): {
  collapsed: Set<string>;
  toggle: (sectionName: string) => void;
} {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(scope));

  useEffect(() => {
    setCollapsed(loadCollapsed(scope));
  }, [scope]);

  const toggle = useCallback(
    (sectionName: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(sectionName)) next.delete(sectionName);
        else next.add(sectionName);
        saveJson(localStorage, storageKeys.collapsedSections(scope), Array.from(next));
        return next;
      });
    },
    [scope],
  );

  return { collapsed, toggle };
}
