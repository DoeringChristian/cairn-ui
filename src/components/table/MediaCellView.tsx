import { useState } from "react";
import { api } from "../../api/client";
import { mediaKind, type MediaCell } from "../../lib/table-media";
import Dialog, { DialogBody } from "../ui/Dialog";

/**
 * One media cell of a table: an image thumbnail, or a small audio/video
 * player. Loaded lazily from `/api/artifacts/{hash}`; a click enlarges images
 * and videos in a dialog.
 */
export default function MediaCellView({ media }: { media: MediaCell }) {
  const [open, setOpen] = useState(false);
  const src = api.artifactUrl(media.hash);
  const kind = mediaKind(media);

  if (kind === "audio") {
    return <audio className="h-8 w-full max-w-[16rem]" controls preload="none" src={src} />;
  }
  if (kind === "file") {
    return (
      <a className="mono text-accent hover:underline" href={src} download title={media.hash}>
        {media.mime_type || "file"}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        className="block cursor-zoom-in"
        onClick={() => setOpen(true)}
        title="Enlarge"
      >
        {kind === "image" ? (
          <img src={src} loading="lazy" alt="" className="h-12 max-w-full rounded-sm object-contain" />
        ) : (
          <video src={src} preload="metadata" muted playsInline className="h-12 max-w-full rounded-sm" />
        )}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={<span className="mono">{media.hash.slice(0, 12)}</span>} size="3xl">
        <DialogBody className="flex items-center justify-center p-4">
          {kind === "image" ? (
            // Fills the dialog: small images scale up, with crisp pixels.
            <img src={src} alt="" className="h-[70vh] w-full object-contain" style={{ imageRendering: "pixelated" }} />
          ) : (
            <video src={src} controls autoPlay className="max-h-[75vh] max-w-full" />
          )}
        </DialogBody>
      </Dialog>
    </>
  );
}
