import { useRouteError } from "react-router-dom";
import { forceReload, isStaleChunkError, reloadForStaleBuild } from "../lib/stale-build";

/**
 * A route that failed to load or render. A lazily loaded page of an older
 * build (the server switched to a newer UI build) reloads the page once,
 * else offers "Reload"; anything else shows its message.
 */
export default function RouteError() {
  const error = useRouteError();
  const stale = isStaleChunkError(error);
  if (stale && reloadForStaleBuild()) return null;
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-fg-muted">
      {stale ? (
        <span>A newer version of cairn is available.</span>
      ) : (
        <>
          <span className="text-status-failed">This page failed to load.</span>
          <span className="mono max-w-xl break-words text-xs text-fg-subtle">{error instanceof Error ? error.message : String(error)}</span>
        </>
      )}
      <button type="button" className="btn text-sm" onClick={forceReload}>
        Reload
      </button>
    </div>
  );
}
