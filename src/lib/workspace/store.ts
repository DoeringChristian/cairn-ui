/**
 * The in-tab working copy of each project's workspace document.
 *
 * Per project it holds the last document the server confirmed (`base`, at
 * `rev`), the local ops not yet written (`pending`) and the document every
 * component renders (`doc = rebase(base, pending)`). sync.ts moves ops to
 * the server; components subscribe through use-workspace.ts. The confirmed
 * document is cached in localStorage so a reload paints without waiting for
 * the server (the same working-copy idea as lib/comparisons/store.ts).
 */

import { loadJson, saveJson, storageKeys } from "../storage";
import { normalizeWorkspace, rebase, type WorkspaceDoc, type WorkspaceOp } from "./doc";

export interface WorkspaceState {
  base: WorkspaceDoc;
  rev: number;
  pending: WorkspaceOp[];
  doc: WorkspaceDoc;
  /** The server document has been fetched this session. */
  loaded: boolean;
  lastFetch: number;
  inflight: boolean;
}

const states = new Map<string, WorkspaceState>();
const listeners = new Map<string, Set<() => void>>();

export function workspaceState(projectId: string): WorkspaceState {
  let s = states.get(projectId);
  if (!s) {
    const cached = loadJson<{ rev?: unknown; payload?: unknown }>(localStorage, storageKeys.workspace(projectId));
    const base = normalizeWorkspace(cached?.payload);
    s = {
      base,
      rev: typeof cached?.rev === "number" ? cached.rev : 0,
      pending: [],
      doc: base,
      loaded: false,
      lastFetch: 0,
      inflight: false,
    };
    states.set(projectId, s);
  }
  return s;
}

export function getWorkspace(projectId: string): WorkspaceDoc {
  return workspaceState(projectId).doc;
}

export function subscribeWorkspace(projectId: string, fn: () => void): () => void {
  let set = listeners.get(projectId);
  if (!set) listeners.set(projectId, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

export function notifyWorkspace(projectId: string): void {
  for (const fn of listeners.get(projectId) ?? []) fn();
}

/** Apply an op locally and queue it for the server. */
export function applyLocal(projectId: string, op: WorkspaceOp): void {
  const s = workspaceState(projectId);
  s.pending.push(op);
  s.doc = op(s.doc);
  notifyWorkspace(projectId);
}

/** Adopt a server document (a fetch or a 409) and replay the pending ops on it. */
export function adoptServer(projectId: string, rev: number, payload: unknown): void {
  const s = workspaceState(projectId);
  s.base = normalizeWorkspace(payload);
  s.rev = rev;
  s.doc = rebase(s.base, s.pending);
  saveJson(localStorage, storageKeys.workspace(projectId), { rev, payload: s.base });
  notifyWorkspace(projectId);
}

/** The first `n` pending ops were written as `payload` at `rev`. */
export function confirmWrite(projectId: string, n: number, rev: number, payload: WorkspaceDoc): void {
  const s = workspaceState(projectId);
  s.base = payload;
  s.rev = rev;
  s.pending = s.pending.slice(n);
  saveJson(localStorage, storageKeys.workspace(projectId), { rev, payload });
}
