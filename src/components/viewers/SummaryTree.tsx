import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { CardType } from "../../lib/cards/card-spec";
import { galleryQuery } from "../../lib/media/gallery-query";
import { isGalleryMedia, summaryMediaOf, summaryThumb, type SummaryMedia } from "../../lib/media/summary-media";
import { cardTypeIcon } from "../../lib/workspace/view-preview";
import CardRenderer from "../CardRenderer";
import Dialog, { DialogBody } from "../ui/Dialog";
import JsonTree from "./JsonTree";

/**
 * A run's summary as logged (`run.summary(...)`, nested) in the shared JSON
 * tree. A media value (lib/media/summary-media.ts) is a leaf: a thumbnail
 * (a gallery: up to four and "+N"; a kind without a picture: its icon and
 * name) and an "open" link showing it full size in its kind's card.
 */
export default function SummaryTree({ runId, summary }: { runId: string; summary: Record<string, unknown> }) {
  const renderLeaf = useCallback((value: unknown, path: string) => {
    const media = summaryMediaOf(value);
    return media ? <SummaryMediaLeaf runId={runId} path={path} media={media} /> : undefined;
  }, [runId]);
  return (
    <div data-summary-tree="">
      <JsonTree value={summary} renderLeaf={renderLeaf} emptyText="No summary." />
    </div>
  );
}

function SummaryMediaLeaf({ runId, path, media }: { runId: string; path: string; media: SummaryMedia }) {
  const [open, setOpen] = useState(false);
  const gallery = useQuery({ ...galleryQuery(media.hash), enabled: isGalleryMedia(media) });
  const thumb = summaryThumb(media, gallery.data);
  return (
    <span className="inline-flex min-w-0 items-center gap-2 self-center py-0.5" data-summary-media={path}>
      {thumb.kind === "images" ? (
        <span className="inline-flex items-center gap-1">
          {thumb.hashes.map((h) => (
            <img
              key={h}
              src={api.artifactUrl(h)}
              loading="lazy"
              alt=""
              className="h-10 max-w-[6rem] rounded-sm border border-border object-contain"
            />
          ))}
          {thumb.more > 0 && <span className="text-fg-subtle">+{thumb.more}</span>}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-fg-muted">
          <i className={`fa-solid ${cardTypeIcon(thumb.objectType as CardType)}`} aria-hidden="true" />
          {thumb.objectType}
        </span>
      )}
      <button
        type="button"
        className="text-xs text-fg-subtle hover:text-accent hover:underline"
        onClick={() => setOpen(true)}
      >
        open
      </button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title={<span className="mono">{path}</span>} size="6xl">
          <DialogBody className="p-4">
            <div>
              <CardRenderer
                runId={runId}
                metric={{ name: path, object_type: media.object_type === "pickle" ? "artifact" : media.object_type, min_step: 0, max_step: 0, count: 1, summary: true }}
              />
            </div>
          </DialogBody>
        </Dialog>
      )}
    </span>
  );
}
