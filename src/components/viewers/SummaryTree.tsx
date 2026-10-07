import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { galleryQuery } from "../../lib/media/gallery-query";
import { isGalleryMedia, summaryMediaLabel, summaryMediaOf, type SummaryMedia } from "../../lib/media/summary-media";
import JsonTree from "./JsonTree";

/**
 * A run's summary as logged (`run.summary(...)`, nested) in the shared JSON
 * tree. A media value (lib/media/summary-media.ts) is a leaf naming its kind
 * ("figure", "6 images") with a link to its card in Metrics & Media: media
 * renders there, the Overview stays metadata.
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
  const { projectId } = useParams<{ projectId: string }>();
  const gallery = useQuery({ ...galleryQuery(media.hash), enabled: isGalleryMedia(media) });
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 text-fg-muted" data-summary-media={path}>
      <span>{summaryMediaLabel(media, gallery.data)}</span>
      <span aria-hidden="true">·</span>
      <Link
        to={`/p/${projectId}/r/${runId}/metrics?card=${encodeURIComponent(path)}`}
        className="text-xs text-fg-subtle hover:text-accent hover:underline"
      >
        show in Metrics &amp; Media
      </Link>
    </span>
  );
}
