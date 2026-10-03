/**
 * Server sync for workspace documents: a debounced PUT carrying the rev it
 * was based on. A 409 means another tab or user wrote first; its body is
 * the server's document, which the pending ops are replayed onto (rebase)
 * before writing again. The project workspace and comparisons use the same
 * protocol at different URLs (ref.ts).
 */

import { api } from "../../api/client";
import { rebase, type WorkspaceOp } from "./doc";
import { refKey, refUrl, type WorkspaceRef } from "./ref";
import { adoptServer, applyLocal, confirmWrite, workspaceState } from "./store";

const FLUSH_DELAY_MS = 400;
/** A fetch younger than this is fresh enough for a newly mounted view. */
const REFETCH_AFTER_MS = 15_000;
const MAX_CONFLICT_RETRIES = 5;

const timers = new Map<string, number>();
/** Fetches in flight, so views mounting together share one. */
const fetching = new Map<string, Promise<void>>();
const refs = new Map<string, WorkspaceRef>();

/** Apply an op locally and schedule the write. */
export function updateWorkspace(ref: WorkspaceRef, op: WorkspaceOp): void {
  applyLocal(refKey(ref), op);
  scheduleFlush(ref);
}

export function scheduleFlush(ref: WorkspaceRef): void {
  installPagehideFlush();
  const key = refKey(ref);
  refs.set(key, ref);
  const t = timers.get(key);
  if (t != null) window.clearTimeout(t);
  timers.set(
    key,
    window.setTimeout(() => {
      timers.delete(key);
      void flushWorkspace(ref);
    }, FLUSH_DELAY_MS),
  );
}

/** Fetch the server document (unless fetched recently), keeping pending ops on top. */
export async function fetchWorkspace(ref: WorkspaceRef, { force = false } = {}): Promise<void> {
  const key = refKey(ref);
  const s = workspaceState(key);
  if (!force && s.loaded && Date.now() - s.lastFetch < REFETCH_AFTER_MS) return;
  const running = fetching.get(key);
  if (running && !force) return running;
  const p = fetchNow(ref, key, s).finally(() => {
    if (fetching.get(key) === p) fetching.delete(key);
  });
  fetching.set(key, p);
  return p;
}

async function fetchNow(ref: WorkspaceRef, key: string, s: ReturnType<typeof workspaceState>): Promise<void> {
  s.lastFetch = Date.now();
  try {
    const res = await api.workspaceDoc(ref);
    // A write in flight will bring its own rev; don't step back to an older one.
    if (s.inflight) return;
    adoptServer(key, res.rev, res.payload);
    s.loaded = true;
  } catch {
    // Offline or no access: keep the cached copy.
  }
}

export async function flushWorkspace(ref: WorkspaceRef): Promise<void> {
  const key = refKey(ref);
  const s = workspaceState(key);
  if (s.inflight || s.pending.length === 0) return;
  // Never write against a rev we haven't seen from the server this session.
  if (!s.loaded) await fetchWorkspace(ref, { force: true });
  if (s.inflight || s.pending.length === 0) return;
  s.inflight = true;
  let again = false;
  try {
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      const n = s.pending.length;
      const payload = rebase(s.base, s.pending);
      const res = await api.putWorkspaceDoc(ref, s.rev, payload as unknown as Record<string, unknown>);
      if (res.ok) {
        confirmWrite(key, n, res.ok.rev, payload);
        again = s.pending.length > 0;
        break;
      }
      adoptServer(key, res.conflict.rev, res.conflict.payload);
    }
  } catch {
    // Network / permission failure: the ops stay pending until the next edit.
  } finally {
    s.inflight = false;
  }
  if (again) scheduleFlush(ref);
}

let pagehideInstalled = false;

/** Leaving the page with a write still queued: send it with `keepalive`. */
function installPagehideFlush(): void {
  if (pagehideInstalled || typeof window === "undefined") return;
  pagehideInstalled = true;
  window.addEventListener("pagehide", () => {
    for (const key of timers.keys()) {
      const ref = refs.get(key);
      const s = workspaceState(key);
      if (!ref || s.pending.length === 0 || s.inflight) continue;
      try {
        void fetch(refUrl(ref), {
          method: "PUT",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base_rev: s.rev, payload: rebase(s.base, s.pending) }),
        });
      } catch {
        /* best effort */
      }
    }
  });
}
