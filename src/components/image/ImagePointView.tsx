import { useQuery } from "@tanstack/react-query";

import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { SequencePoint } from "../../api/types";
import { describeEncoding, GALLERY_MIME, isBrowserDisplayable } from "../../lib/artifact-format";
import { artifactFilename } from "../../lib/download";
import UnsupportedArtifact from "../UnsupportedArtifact";
import ImagePane, { type PaneTransform } from "./ImagePane";

/** One stored image: a single point's artifact, or one entry of a gallery. */
interface ImageItem {
  hash: string;
  mime: string | null | undefined;
  metadata: Record<string, unknown> | null;
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A point's images: itself, or — for a gallery — the entries of its manifest. */
function useImageItems(point: SequencePoint | null): { items: ImageItem[]; loading: boolean } {
  const isGallery = point?.artifact_mime === GALLERY_MIME;
  const manifest = useQuery({
    queryKey: qk.imageGallery(point?.artifact_hash),
    queryFn: async () => {
      const res = await fetch(api.artifactUrl(point!.artifact_hash!));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as { images: Array<{ hash: string; mime_type: string; metadata: Record<string, unknown> }> };
    },
    enabled: isGallery && !!point?.artifact_hash,
    staleTime: Infinity,
  });
  if (!point?.artifact_hash) return { items: [], loading: false };
  if (!isGallery) {
    return {
      items: [{ hash: point.artifact_hash, mime: point.artifact_mime, metadata: parseMetadata(point.artifact_metadata) }],
      loading: false,
    };
  }
  const items = (manifest.data?.images ?? []).map((i) => ({ hash: i.hash, mime: i.mime_type, metadata: i.metadata }));
  return { items, loading: manifest.isLoading };
}

interface Props {
  metricName: string;
  point: SequencePoint | null;
  /** Reference point; a gallery reference pairs with this point's images by index. */
  refPoint?: SequencePoint | null;
  refLabel?: string;
  split: number;
  onSplitChange: (split: number, final: boolean) => void;
  transform: PaneTransform;
  onTransformChange: (t: PaneTransform) => void;
  loadingHint: boolean;
}

/**
 * Everything one run shows at the current step: an image, or a gallery of
 * images in a grid. Every image shares the card's zoom and divider.
 */
export default function ImagePointView({
  metricName, point, refPoint, refLabel, split, onSplitChange, transform, onTransformChange, loadingHint,
}: Props) {
  const { items, loading } = useImageItems(point);
  const refs = useImageItems(refPoint ?? null);

  if (!point || (items.length === 0 && !loading)) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
        {loadingHint ? "Loading…" : "No image logged"}
      </div>
    );
  }
  if (loading) return <div className="h-full motion-safe:animate-pulse bg-bg-hover" />;

  const gallery = items.length > 1;
  const cell = (item: ImageItem, i: number) => {
    const url = api.artifactUrl(item.hash);
    const label = gallery ? `${metricName} · ${point.step} · #${i}` : `${metricName} · ${point.step}`;
    if (!isBrowserDisplayable(item.mime)) {
      return (
        <UnsupportedArtifact
          key={item.hash + i}
          label={`${describeEncoding(item.mime, item.metadata)} — not viewable in the browser`}
          detail={gallery ? `step ${point.step} · #${i}` : `step ${point.step}`}
          previewSrc={typeof item.metadata?.preview === "string" ? item.metadata.preview : undefined}
          downloadUrl={url}
          filename={artifactFilename(gallery ? `${metricName}_${i}` : metricName, point.step, item.mime)}
        />
      );
    }
    const ref = refs.items.length > 1 ? refs.items[i] : refs.items[0];
    const refShown = ref && isBrowserDisplayable(ref.mime)
      ? { src: api.artifactUrl(ref.hash), label: `${refLabel ?? "reference"}${refs.items.length > 1 ? ` · #${i}` : ""}` }
      : null;
    return (
      <ImagePane
        key={item.hash + i}
        image={{ src: url, label }}
        reference={refShown}
        split={split}
        onSplitChange={onSplitChange}
        transform={transform}
        onTransformChange={onTransformChange}
      />
    );
  };

  if (!gallery) return cell(items[0]!, 0);
  // Near-square grid of equal cells.
  const cols = Math.ceil(Math.sqrt(items.length));
  return (
    <div
      className="grid h-full w-full gap-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
    >
      {items.map((item, i) => (
        <div key={item.hash + i} className="relative min-h-0 min-w-0 overflow-hidden">
          {cell(item, i)}
        </div>
      ))}
    </div>
  );
}
