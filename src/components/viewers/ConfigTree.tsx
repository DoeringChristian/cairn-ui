import { useRun } from "../../api/hooks";
import JsonTree from "./JsonTree";

/**
 * A run's config as logged (`run.config(...)`, nested), in the shared JSON
 * tree: the run page, the lineage panel and an artifact's producer all show
 * a config this one way. Values are exact (a config is what was set).
 */
export default function ConfigTree({
  config,
  openDepth = 2,
  className = "",
}: {
  config: Record<string, unknown> | null | undefined;
  openDepth?: number;
  className?: string;
}) {
  return (
    <div className={className} data-config-tree="">
      <JsonTree value={config ?? {}} openDepth={openDepth} emptyText="No config." />
    </div>
  );
}

/** A run's config by id (loads the run). */
export function RunConfigTree({ runId, openDepth, className }: { runId: string; openDepth?: number; className?: string }) {
  const q = useRun(runId);
  if (q.isLoading) return <p className="text-xs text-fg-subtle">Loading…</p>;
  if (q.isError) return <p className="text-xs text-fg-subtle">The run's config is not available.</p>;
  return <ConfigTree config={q.data?.config_doc} openDepth={openDepth} className={className} />;
}
