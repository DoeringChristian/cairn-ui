import { downloadArtifact } from "../lib/download";

interface Props {
  label: string;
  detail?: string;
  previewSrc?: string;
  downloadUrl: string;
  filename?: string;
}

/** Placeholder for an artifact the browser can't display: thumbnail, what it is, and a download. */
export default function UnsupportedArtifact({ label, detail, previewSrc, downloadUrl, filename }: Props) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
      {previewSrc && (
        <img src={previewSrc} alt="" className="max-h-[50%] max-w-full object-contain opacity-80" style={{ imageRendering: "pixelated" }} />
      )}
      <div className="text-xs text-fg-muted">{label}</div>
      {detail && <div className="text-[10px] text-fg-subtle">{detail}</div>}
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded border border-accent px-2 py-0.5 text-xs text-accent hover:bg-accent/10"
        onClick={() => downloadArtifact(downloadUrl, filename ?? "artifact")}
      >
        <i className="fa-solid fa-download" aria-hidden="true" /> Download
      </button>
    </div>
  );
}
