import { useState } from "react";
import { api } from "../../api/client";
import { mediaKind, type MediaCell } from "../../lib/table-media";
import { hashSource } from "../../lib/viewers/source";
import Dialog, { DialogBody } from "../ui/Dialog";
import AudioViewer from "../viewers/AudioViewer";
import ContentViewer from "../viewers/ContentViewer";

/**
 * One media cell of a table: an image thumbnail, a video's first frame, or a
 * small audio player. Loaded lazily from `/api/artifacts/{hash}`; a click
 * opens images and videos in the shared viewer (zoom and pan, the video
 * player) in a dialog.
 */
export default function MediaCellView({ media }: { media: MediaCell }) {
  const [open, setOpen] = useState(false);
  const src = api.artifactUrl(media.hash);
  const kind = mediaKind(media);
  const source = hashSource(media.hash, { mime: media.mime_type || null, objectType: media.object_type ?? null });

  if (kind === "audio") return <AudioViewer source={source} compact />;
  if (kind === "file") {
    return (
      <a className="mono text-accent hover:underline" href={src} download title={media.hash}>
        {media.mime_type || "file"}
      </a>
    );
  }

  return (
    <>
      <button type="button" className="block cursor-zoom-in" onClick={() => setOpen(true)} title="Enlarge">
        {kind === "image" ? (
          <img src={src} loading="lazy" alt="" className="h-12 max-w-full rounded-sm object-contain" />
        ) : (
          <video src={src} preload="metadata" muted playsInline className="h-12 max-w-full rounded-sm" />
        )}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={<span className="mono">{media.hash.slice(0, 12)}</span>} size="3xl">
        <DialogBody className="h-[75vh] p-4">
          <ContentViewer source={source} kind={kind} fill />
        </DialogBody>
      </Dialog>
    </>
  );
}
