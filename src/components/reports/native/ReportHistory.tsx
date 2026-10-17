import { Select } from "../../../prism/Select";
import { useEffect, useState } from "react";
export function ReportHistory({reportId, versionId, onChange}: {reportId: string; versionId: string; onChange: (version: string) => void}) {
  const [versions, setVersions] = useState<{version_id: string; published_at: string; current: boolean}[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {const controller = new AbortController(); fetch(`/api/reports/${encodeURIComponent(reportId)}/history`, {signal: controller.signal}).then(async response => {if (!response.ok) throw new Error("Could not load publication history."); return response.json();}).then(value => setVersions(value.versions)).catch(error => {if (!controller.signal.aborted) setError(String(error));}); return () => controller.abort();}, [reportId, versionId]);
  return <div className="min-w-0 text-sm"><Select label="Publication version" value={versionId} onChange={onChange} options={versions.length ? versions.map(version => ({value:version.version_id,label:`${new Date(version.published_at).toLocaleString()}${version.current ? " · current" : ""}`})) : [{value:versionId,label:versionId.slice(0,8)}]}/>{error && <span role="alert">{error}</span>}</div>;
}
