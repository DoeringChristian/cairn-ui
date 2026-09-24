import { useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSequences } from "../../api/hooks";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import Popover from "../ui/Popover";
import { useCompactViewport } from "../../lib/use-media-query";
import type { SequenceMeta } from "../../api/types";

export interface ChipValue {
  name: string;
}

interface Props {
  /** Single run ID (classic single-run mode). */
  runId: string;
  /** Multiple run IDs for workspace/comparison mode. When set, fetches from all runs. */
  runIds?: string[];
  value: ChipValue[];
  onChange: (next: ChipValue[]) => void;
  /** Called when adding a tag in multi-run mode, with the runs that have it. */
  onAddTag?: (tagName: string, runs: Array<{ runId: string }>) => void;
  /** Filter available metrics; default: scalar only. Pass "any" to include all types. */
  objectType?: string | "scalar" | "any";
  /** Multi-run tag picking: `value` holds one entry per run, shown once per name. */
  tagMode?: boolean;
}

export default function MetricChips({
  runId,
  runIds,
  value,
  onChange,
  onAddTag,
  objectType = "scalar",
  tagMode = false,
}: Props) {
  // Single-run fetch (used when runIds is not provided)
  const singleQ = useSequences(runIds ? "" : runId);

  // Multi-run fetch
  const multiQueries = useQueries({
    queries: (runIds ?? []).map((rid) => ({
      queryKey: qk.sequences(rid),
      queryFn: () => api.sequences(rid),
      staleTime: 10_000,
    })),
  });

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const compact = useCompactViewport();

  const selectedKeys = useMemo(() => new Set(value.map((c) => c.name)), [value]);

  // Display chips, deduplicated by name (tag mode holds one entry per run).
  const displayChips = useMemo(() => {
    const seen = new Set<string>();
    return value.filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
  }, [value]);

  // Map tag name → runs (for multi-run mode)
  const tagRunMap = useMemo(() => {
    if (!runIds) return null;
    const map = new Map<string, Array<{ runId: string }>>();
    multiQueries.forEach((q, idx) => {
      const rid = runIds[idx];
      if (!rid || !q.data) return;
      for (const seq of q.data.sequences) {
        if (objectType !== "any" && seq.object_type !== objectType) continue;
        const arr = map.get(seq.name) ?? [];
        if (!arr.some((r) => r.runId === rid)) {
          arr.push({ runId: rid });
        }
        map.set(seq.name, arr);
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, objectType, multiQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const availableMetrics = useMemo(() => {
    if (runIds && tagRunMap) {
      // Multi-run: show unique tag names not already selected
      let arr = Array.from(tagRunMap.keys())
        .filter((n) => !selectedKeys.has(n))
        .sort();
      const q = filter.trim().toLowerCase();
      if (q) arr = arr.filter((n) => n.toLowerCase().includes(q));
      return arr.map((name) => ({ name }));
    }
    // Single-run mode
    const sequences: SequenceMeta[] = singleQ.data?.sequences ?? [];
    const byType =
      objectType === "any"
        ? sequences
        : sequences.filter((s) => s.object_type === objectType);
    const result = byType.filter((s) => !selectedKeys.has(s.name));
    const q = filter.trim().toLowerCase();
    return result
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .map((s) => ({ name: s.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, tagRunMap, singleQ.data, objectType, selectedKeys, filter]);

  const removeChip = (chip: ChipValue) => {
    onChange(value.filter((c) => c.name !== chip.name));
  };

  const addChip = (chip: ChipValue) => {
    if (runIds && onAddTag && tagRunMap) {
      // Multi-run: delegate to parent with run info
      const runs = tagRunMap.get(chip.name) ?? [];
      onAddTag(chip.name, runs);
    } else {
      if (selectedKeys.has(chip.name)) return;
      onChange([...value, chip]);
    }
    setFilter("");
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {displayChips.map((chip) => (
          <span
            key={chip.name}
            className="mono inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted touch:py-0 touch:pr-0"
          >
            <span>{chip.name}</span>
            <button
              type="button"
              onClick={() => removeChip(chip)}
              aria-label={`Remove ${chip.name}`}
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg touch:h-8 touch:w-8"
            >
              <span aria-hidden="true" className="text-sm leading-none">×</span>
            </button>
          </span>
        ))}
        <button
          ref={addButtonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Add metric"
          aria-expanded={open}
          className="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-bg text-xs text-fg-muted hover:border-accent hover:text-fg touch:h-10 touch:w-10"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={addButtonRef}
        title={tagMode ? "Add tag" : "Add metric"}
        width={256}
        align="start"
      >
        <div className="sticky top-0 border-b border-border-subtle bg-bg-elevated p-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter metrics…"
            className="input"
          />
        </div>
        <div className={compact ? "" : "max-h-56 overflow-y-auto"}>
          {availableMetrics.length === 0 ? (
            <div className="px-3 py-2 text-xs text-fg-subtle">
              {(runIds ? multiQueries : [singleQ]).some((q) => q.isLoading)
                ? "Loading…"
                : "no matching metrics"}
            </div>
          ) : (
            availableMetrics.map((m) => (
              <button
                key={m.name}
                type="button"
                onClick={() => addChip(m)}
                className="mono block w-full truncate px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-hover hover:text-fg touch:min-h-10"
              >
                {m.name}
              </button>
            ))
          )}
        </div>
      </Popover>
    </div>
  );
}
