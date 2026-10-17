import { useEffect, useRef, useState } from "react";
type Entry = {path: string; size: number; mime?: string};
export function ReportFiles({reportId, versionId}: {reportId: string; versionId: string}) {
  const previewRequest = useRef(0);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<Entry[]>([]);
  const [selected, setSelected] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const base = `/api/reports/${encodeURIComponent(reportId)}`;
  const fileUrl = (path: string) => `${base}/builds/${encodeURIComponent(versionId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  useEffect(() => {if (!open) return; const controller = new AbortController(); setError(""); fetch(`${base}/files?version_id=${encodeURIComponent(versionId)}`, {signal: controller.signal}).then(async response => {if (!response.ok) throw new Error("Could not load captured files."); return response.json();}).then(value => setFiles(value.files)).catch(error => {if (!controller.signal.aborted) setError(String(error));}); return () => controller.abort();}, [base, versionId, open]);
  const preview = async (file: Entry) => {
    const requestId = ++previewRequest.current;
    setSelected(file.path); setSource(""); setError("");
    if (file.size > 1024 * 1024 || !/\.(qmd|md|py|json|txt|yaml|yml|toml|lock|csv|log)$/.test(file.path)) {setSource("Download this file to inspect it."); return;}
    try {const response = await fetch(fileUrl(file.path)); if (!response.ok) throw new Error("Could not read captured source."); const text = await response.text(); if (requestId === previewRequest.current) setSource(text);} catch(error) {if (requestId === previewRequest.current) setError(String(error));}
  };
  return <><button className="btn" onClick={() => setOpen(!open)}>{open ? "Close files" : "Captured files"}</button>{open && <aside className="fixed inset-6 z-50 rounded border border-border bg-bg-elevated shadow-xl p-5 overflow-auto" aria-label="Captured report files"><header className="flex justify-between mb-4"><h2 className="text-xl">Captured files · {versionId.slice(0, 8)}</h2><button onClick={() => setOpen(false)}>Close files</button></header>{error && <p role="alert">{error}</p>}<div className="grid gap-5 md:grid-cols-[280px_1fr]"><nav className="overflow-auto">{files.map(file => <button className="block text-left text-sm p-1 break-all" key={file.path} onClick={() => void preview(file)}>{file.path}</button>)}</nav><section>{selected && <a className="text-accent underline" href={fileUrl(selected)} download>Download {selected}</a>}<pre className="mt-4 text-xs whitespace-pre-wrap break-words">{source || "Select a source, environment, or captured evidence file."}</pre></section></div></aside>}</>;
}
