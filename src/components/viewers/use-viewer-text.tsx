import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatBytes } from "../../lib/format";
import { sourceTextQuery, type ViewerSource } from "../../lib/viewers/source";

export interface ViewerText {
  /** The text (the previous source's while the next one loads); undefined before the first. */
  text: string | undefined;
  /** Only the head of the file was read (`maxBytes`). */
  cut: boolean;
  loading: boolean;
  error: Error | null;
}

/**
 * A source's bytes as text for a text viewer: whole, or its first
 * `maxBytes` when it is known to be bigger. The previous text stays while
 * the next loads (a card stepping never flashes empty).
 */
export function useViewerText(source: Pick<ViewerSource, "hash" | "size">, maxBytes?: number, enabled = true): ViewerText {
  const { query, cut } = sourceTextQuery(source, maxBytes);
  const q = useQuery({ ...query, enabled, placeholderData: keepPreviousData });
  return {
    text: q.data,
    cut,
    loading: q.isLoading,
    error: q.isError && !q.isPlaceholderData ? (q.error as Error) : null,
  };
}

/** "Showing the first 256 KB of 3.1 MB": over a viewer that read only the head of a file. */
export function TruncatedNote({ shown, total, what = "" }: { shown: number; total: number | null; what?: string }) {
  return (
    <p className="text-xs text-fg-muted" data-truncated="">
      Showing the first {what || formatBytes(shown)}
      {total != null ? ` of ${formatBytes(total)}` : ""}; download for the rest.
    </p>
  );
}

/** A viewer's loading placeholder. */
export function ViewerLoading({ className = "h-24" }: { className?: string }) {
  return <div className={`${className} w-full motion-safe:animate-pulse rounded bg-bg-hover`} />;
}

/** A viewer's load error. */
export function ViewerError({ error }: { error: unknown }) {
  return <p className="text-xs text-status-failed">{error instanceof Error ? error.message : String(error)}</p>;
}
