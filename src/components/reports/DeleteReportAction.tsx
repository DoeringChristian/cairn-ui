import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
export function DeleteReportAction({projectId, reportId, versionId, name, onDeleted}: {projectId: string; reportId: string; versionId?: string; name: string; onDeleted?: () => void}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const remove = async () => {
    if (!window.confirm(`Delete report “${name}”? Its published build files will be retained.`)) return;
    setBusy(true); setError("");
    try {
      const version = versionId || (await api.report(projectId, reportId)).version_id;
      if (!version) throw new Error("Reload this report before deleting it.");
      await api.deleteReport(projectId, reportId, version);
      await qc.invalidateQueries({queryKey: qk.reports(projectId)});
      onDeleted?.();
    } catch (error) {setError(error instanceof Error ? error.message : String(error));}
    finally {setBusy(false);}
  };
  return <><button type="button" className="text-fg-muted hover:text-status-failed text-xl px-2" aria-label="Delete report" title="Delete report" disabled={busy} onClick={() => void remove()}>{busy ? "…" : "×"}</button>{error && <p role="alert" className="text-sm text-status-failed">{error}</p>}</>;
}
