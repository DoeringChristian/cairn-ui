import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { forceReload, isStaleChunkError, reloadForStaleBuild } from "../lib/stale-build";

/**
 * A route that failed to load or render. A lazily loaded page of an older
 * build (the server switched to a newer UI build) reloads the page once,
 * else offers "Reload"; a URL no route matches says so; anything else shows
 * its message.
 */
export default function RouteError() {
  const error = useRouteError();
  const stale = isStaleChunkError(error);
  if (stale && reloadForStaleBuild()) return null;
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-fg-muted">
        <span>There is no page at this address.</span>
        <Link to="/" className="btn text-sm">
          Projects
        </Link>
      </div>
    );
  }
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-fg-muted">
      {stale ? (
        <span>A newer version of cairn is available.</span>
      ) : (
        <>
          <span className="text-status-failed">This page failed to load.</span>
          <span className="mono max-w-xl break-words text-xs text-fg-subtle">{errorMessage(error)}</span>
        </>
      )}
      <button type="button" className="btn text-sm" onClick={forceReload}>
        Reload
      </button>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
  return String(error);
}
