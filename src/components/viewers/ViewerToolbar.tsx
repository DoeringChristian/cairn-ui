import { downloadArtifact } from "../../lib/download";
import { ICON_BTN } from "../card-header/icon-btn";

/**
 * A standalone viewer's corner controls (a card has them in its header):
 * reset the zoom/pan (only while it is changed) and download the file.
 */
export default function ViewerToolbar({
  onResetView,
  download,
}: {
  onResetView?: () => void;
  download?: { url: string; name: string };
}) {
  if (!onResetView && !download) return null;
  return (
    <div className="absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded bg-bg/80 p-0.5 shadow-sm" data-viewer-toolbar="">
      {onResetView && (
        <button type="button" className={ICON_BTN} onClick={onResetView} title="Reset view (or double-click)" aria-label="Reset view">
          <i className="fa-solid fa-house text-[11px]" aria-hidden="true" />
        </button>
      )}
      {download && (
        <button
          type="button"
          className={ICON_BTN}
          onClick={() => downloadArtifact(download.url, download.name)}
          title={`Download ${download.name}`}
          aria-label="Download"
        >
          <i className="fa-solid fa-arrow-down text-[11px]" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
