import { useMemo, useRef, useState } from "react";
import { useSequences } from "../../api/hooks";
import Popover from "../ui/Popover";
import { useCompactViewport } from "../ui/use-compact-viewport";

/**
 * The "+ Reference tag" dropdown every per-kind media card renders in its
 * settings panel: pick another series (same `object_type` ONLY — cross-type
 * references were dropped with the media-shell dissolution) as the compare
 * baseline. The selected tag is resolved independently in every foreground
 * pane's run; no run is privileged as the card-wide baseline.
 */
export function ExternalBaselinePicker({
  runId,
  objectType,
  currentMetricName,
  selected,
  onSelect,
}: {
  runId: string;
  objectType: string;
  currentMetricName: string;
  selected?: string;
  onSelect: (name: string, contextHash: string) => void;
}) {
  const { data } = useSequences(runId);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const compact = useCompactViewport();

  const candidateMetrics = useMemo(() => {
    const seqs = data?.sequences ?? [];
    return seqs
      .filter((s) => s.name !== currentMetricName && s.object_type === objectType)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, currentMetricName, objectType]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? candidateMetrics.filter((m) => m.name.toLowerCase().includes(q)) : candidateMetrics;
  }, [candidateMetrics, filter]);

  return (
    <div className="mt-1">
      <button
        ref={btnRef}
        type="button"
        onClick={() => { setOpen((v) => !v); setFilter(""); }}
        className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg touch:min-h-10"
      >
        <span aria-hidden="true">+</span> Reference tag
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        title="Reference tag"
        width={224}
        align="start"
      >
        <div className="sticky top-0 border-b border-border-subtle bg-bg-elevated p-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags..."
            className="input w-full text-xs"
          />
        </div>
        <div className={compact ? "" : "max-h-40 overflow-y-auto"}>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-fg-subtle">No other {objectType} tags</div>
          ) : (
            filtered.map((m) => (
              <button
                key={`${m.name}::${m.context_hash}`}
                type="button"
                onClick={() => { onSelect(m.name, m.context_hash); setOpen(false); }}
                className={`mono block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-bg-hover touch:min-h-10 ${
                  selected === m.name ? "text-accent" : "text-fg-muted hover:text-fg"
                }`}
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
