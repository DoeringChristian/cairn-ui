/**
 * The project's default viewer per type (Defaults page): every kind of data
 * has exactly one. Built-in types show in their own renderer, or in the
 * built-in viewer cairn ships for them (`cairn.volume` for volumes), until
 * the project picks another; a custom kind's default is the viewer published
 * for it first or declared with `default_for`. A card can still pin its own
 * viewer (its Viewer setting). Server: cairn.server.viewer_defaults.
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useSession } from "../api/hooks";
import type { ViewerDefaults, ViewerInfo } from "../api/types";
import { useViewerDefaults, useViewerList } from "../lib/custom/hooks";
import { acceptMatches, type SeriesKind } from "../lib/custom/manifest";
import { VIEWER_DEFAULT_TYPES, currentViewers } from "../lib/custom/viewers";
import { Select } from "./settings/palette";

/** A defaults key as a series: `volume`, `custom:guiding/*` → kind `guiding/*`. */
function keySeries(key: string): SeriesKind {
  return key.startsWith("custom:") ? { object_type: "custom", kind: key.slice("custom:".length) } : { object_type: key };
}

const label = (v: ViewerInfo) => `${v.title || v.name}${v.builtin ? " (built-in)" : ""}`;

/** The kinds listed: built-in types some viewer accepts, custom kinds viewers accept, and every key with a default. */
export function viewerDefaultKeys(viewers: readonly ViewerInfo[], defaults: ViewerDefaults | undefined): string[] {
  const keys = new Set<string>([...Object.keys(defaults?.defaults ?? {}), ...Object.keys(defaults?.builtin ?? {})]);
  for (const v of viewers) {
    for (const p of v.accepts) if (p.startsWith("custom:")) keys.add(p);
    for (const t of VIEWER_DEFAULT_TYPES) if (v.accepts.some((p) => acceptMatches(p, { object_type: t }))) keys.add(t);
  }
  const builtin = (k: string) => (k.startsWith("custom:") ? 1 : 0);
  return [...keys].sort((a, b) => builtin(a) - builtin(b) || a.localeCompare(b));
}

export default function ViewerDefaultsEditor({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const list = useViewerList(projectId).data;
  const defaults = useViewerDefaults(projectId).data;
  const readOnly = useSession().data?.role === "read";
  const [error, setError] = useState<string | null>(null);
  const viewers = useMemo(() => currentViewers(list ?? []), [list]);
  const keys = useMemo(() => viewerDefaultKeys(viewers, defaults), [viewers, defaults]);

  const change = async (kind: string, viewer: string | null) => {
    setError(null);
    try {
      qc.setQueryData(qk.viewerDefaults(projectId), await api.setViewerDefault(projectId, kind, viewer));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!list || !defaults) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (keys.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No custom viewers yet: every type shows in its built-in card. Publish one with{" "}
        <code className="mono">cairn viewer publish ./viewers/my-viewer --project {projectId}</code>.
      </p>
    );
  }
  return (
    <div data-testid="viewer-defaults">
      {keys.map((key) => {
        const series = keySeries(key);
        const custom = key.startsWith("custom:");
        const accepting = viewers.filter((v) => !v.error && v.accepts.some((p) => acceptMatches(p, series)));
        const fallback = defaults.builtin[key];
        const fallbackInfo = fallback ? viewers.find((v) => v.name === fallback) : undefined;
        // "" clears the project's choice: the built-in viewer cairn ships for it, else the type's own card.
        const none = fallbackInfo ? label(fallbackInfo) : custom ? "None" : "Built-in card";
        const options = [
          { value: "", label: none },
          ...accepting.filter((v) => v.name !== fallback).map((v) => ({ value: v.name, label: label(v) })),
        ];
        const value = defaults.defaults[key] ?? "";
        if (value && !options.some((o) => o.value === value)) options.push({ value, label: `${value} (missing)` });
        return (
          <Select
            key={key}
            label={<span className="mono">{custom ? key.slice("custom:".length) : key}</span>}
            description={custom ? "custom data" : undefined}
            value={value}
            onChange={(v) => void change(key, v || null)}
            options={options}
            disabled={readOnly}
          />
        );
      })}
      {error && <p className="mt-2 text-xs text-status-failed">{error}</p>}
    </div>
  );
}
