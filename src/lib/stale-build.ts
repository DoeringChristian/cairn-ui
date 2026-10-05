/**
 * A page loaded before the server switched to a newer UI build asks for code
 * chunks (hashed file names) that no longer exist: a lazily loaded card,
 * page or viewer then fails with "Failed to fetch dynamically imported
 * module". The fix is the new build, so the page reloads — once per build
 * (sessionStorage remembers the build it reloaded for), so a chunk that is
 * missing for another reason shows its error instead of looping.
 */

/** Whether `err` is a code chunk that could not be loaded (Chrome, Firefox, Safari and Vite's preload wording). */
export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(msg);
}

/** The build this page runs: its entry script's hashed name (`/assets/index-<hash>.js`). */
export function currentBuildId(doc: Pick<Document, "querySelector"> = document): string {
  const s = doc.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return s?.getAttribute("src") ?? "dev";
}

const KEY = "cairn:stale-build-reload";

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/**
 * Reload for a missing chunk unless this build already did: true when it
 * will reload (the caller stops there), false when it already tried — the
 * error is real, show it.
 */
export function reloadOnceForStaleBuild(buildId: string, store: Store | null, reload: () => void): boolean {
  // Without storage the page could not tell it already tried: no automatic reload (the error offers one).
  if (!store) return false;
  try {
    if (store.getItem(KEY) === buildId) return false;
    store.setItem(KEY, buildId);
  } catch {
    return false;
  }
  reload();
  return true;
}

function sessionStore(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** For the app: reload once for a missing chunk of this build. */
export function reloadForStaleBuild(): boolean {
  return reloadOnceForStaleBuild(currentBuildId(), sessionStore(), () => window.location.reload());
}

/** The reload button's: always reload (the user asked). */
export function forceReload(): void {
  try {
    sessionStore()?.setItem(KEY, "");
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/** Install the page-wide handlers: Vite's preload failures and unhandled dynamic-import rejections. */
export function installStaleBuildReload(): void {
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadForStaleBuild()) e.preventDefault();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (isStaleChunkError(e.reason) && reloadForStaleBuild()) e.preventDefault();
  });
}
