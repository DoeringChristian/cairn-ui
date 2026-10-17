import { useEffect, useState } from "react";
export function BuildDiagnostics({buildId}: {buildId: string}) {
  const [files, setFiles] = useState<{path: string; size: number}[]>([]);
  const [error, setError] = useState("");
  const base = `/api/report-builds/${encodeURIComponent(buildId)}/diagnostics`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(base, {signal: controller.signal}).then(async response => {if (!response.ok) throw new Error("Could not load build diagnostics."); return response.json();}).then(value => setFiles(value.files)).catch(error => {if (!controller.signal.aborted) setError(String(error));});
    return () => controller.abort();
  }, [base]);
  return <div className="mt-2 text-sm"><strong>Build diagnostics</strong>{error && <p role="alert">{error}</p>}<ul>{files.map(file => <li key={file.path}><a className="text-accent underline" href={`${base}/${file.path.split("/").map(encodeURIComponent).join("/")}`} download>{file.path}</a> <span className="text-fg-muted">({file.size.toLocaleString()} bytes)</span></li>)}</ul></div>;
}
