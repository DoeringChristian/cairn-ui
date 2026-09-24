import { downloadArtifact } from "../lib/download";

interface Props {
  /** What this is and why it isn't shown, e.g. "Volume — not viewable in the browser". */
  label: string;
  /** Secondary line, e.g. shape/dtype. */
  detail?: string;
  /** Optional thumbnail, drawn pixelated. */
  previewSrc?: string;
  downloadUrl: string;
  filename?: string;
}

/** Placeholder for an artifact the browser can't render: optional thumbnail, a label, and a Download button. */
export default function UnsupportedArtifact({ label, detail, previewSrc, downloadUrl, filename }: Props) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden rounded bg-bg p-4 text-center">
      {previewSrc && (
        <img
          src={previewSrc}
          alt=""
          className="min-h-0 max-w-full flex-shrink object-contain"
          style={{ imageRendering: "pixelated", maxHeight: "50%" }}
        />
      )}
      <div className="text-sm text-fg-muted">{label}</div>
      {detail && <div className="mono text-xs text-fg-subtle">{detail}</div>}
      <button
        type="button"
        className="rounded border border-border px-3 py-1 text-xs hover:bg-bg-hover"
        onClick={() => downloadArtifact(downloadUrl, filename ?? "")}
      >
        Download
      </button>
    </div>
  );
}
