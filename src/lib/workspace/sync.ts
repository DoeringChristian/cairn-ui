/**
 * Server sync for the workspace document: a debounced PUT carrying the rev
 * it was based on. A 409 means another tab or user wrote first; its body is
 * the server's document, which the pending ops are replayed onto (rebase)
 * before writing again.
 */

import { api } from "../../api/client";
import { rebase, type WorkspaceOp } from "./doc";
import { adoptServer, applyLocal, confirmWrite, workspaceState } from "./store";

const FLUSH_DELAY_MS = 400;
/** A fetch younger than this is fresh enough for a newly mounted view. */
const REFETCH_AFTER_MS = 15_000;
const MAX_CONFLICT_RETRIES = 5;

const timers = new Map<string, number>();

/** Apply an op locally and schedule the write. */
export function updateWorkspace(projectId: string, op: WorkspaceOp): void {
  applyLocal(projectId, op);
  scheduleFlush(projectId);
}

export function scheduleFlush(projectId: string): void {
  installPagehideFlush();
  const t = timers.get(projectId);
  if (t != null) window.clearTimeout(t);
  timers.set(
    projectId,
    window.setTimeout(() => {
      timers.delete(projectId);
      void flushWorkspace(projectId);
    }, FLUSH_DELAY_MS),
  );
}

/** Fetch the server document (unless fetched recently), keeping pending ops on top. */
export async function fetchWorkspace(projectId: string, { force = false } = {}): Promise<void> {
  const s = workspaceState(projectId);
  if (!force && s.loaded && Date.now() - s.lastFetch < REFETCH_AFTER_MS) return;
  s.lastFetch = Date.now();
  try {
    const res = await api.workspace(projectId);
    // A write in flight will bring its own rev; don't step back to an older one.
    if (s.inflight) return;
    adoptServer(projectId, res.rev, res.payload);
    s.loaded = true;
  } catch {
    // Offline or no access: keep the cached copy.
  }
}

export async function flushWorkspace(projectId: string): Promise<void> {
  const s = workspaceState(projectId);
  if (s.inflight || s.pending.length === 0) return;
  // Never write against a rev we haven't seen from the server this session.
  if (!s.loaded) await fetchWorkspace(projectId, { force: true });
  if (s.inflight || s.pending.length === 0) return;
  s.inflight = true;
  let again = false;
  try {
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      const n = s.pending.length;
      const payload = rebase(s.base, s.pending);
      const res = await api.putWorkspace(projectId, s.rev, payload as unknown as Record<string, unknown>);
      if (res.ok) {
        confirmWrite(projectId, n, res.ok.rev, payload);
        again = s.pending.length > 0;
        break;
      }
      adoptServer(projectId, res.conflict.rev, res.conflict.payload);
    }
  } catch {
    // Network / permission failure: the ops stay pending until the next edit.
  } finally {
    s.inflight = false;
  }
  if (again) scheduleFlush(projectId);
}

let pagehideInstalled = false;

/** Leaving the page with a write still queued: send it with `keepalive`. */
function installPagehideFlush(): void {
  if (pagehideInstalled || typeof window === "undefined") return;
  pagehideInstalled = true;
  window.addEventListener("pagehide", () => {
    for (const projectId of timers.keys()) {
      const s = workspaceState(projectId);
      if (s.pending.length === 0 || s.inflight) continue;
      try {
        void fetch(`/api/projects/${projectId}/workspace`, {
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
