/**
 * The in-tab working copy of each workspace document (the project workspace
 * and every open comparison), keyed by `refKey`.
 *
 * Per document it holds the last version the server confirmed (`base`, at
 * `rev`), the local ops not yet written (`pending`) and the document every
 * component renders (`doc = rebase(base, pending)`). sync.ts moves ops to
 * the server; components subscribe through use-workspace.ts. The confirmed
 * document is cached in localStorage so a reload paints without waiting for
 * the server.
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

export function workspaceState(key: string): WorkspaceState {
  let s = states.get(key);
  if (!s) {
    const cached = loadJson<{ rev?: unknown; payload?: unknown }>(localStorage, storageKeys.workspace(key));
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
    states.set(key, s);
  }
  return s;
}

export function getWorkspace(key: string): WorkspaceDoc {
  return workspaceState(key).doc;
}

export function subscribeWorkspace(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

export function notifyWorkspace(key: string): void {
  for (const fn of listeners.get(key) ?? []) fn();
}

/** Apply an op locally and queue it for the server. */
export function applyLocal(key: string, op: WorkspaceOp): void {
  const s = workspaceState(key);
  s.pending.push(op);
  s.doc = op(s.doc);
  notifyWorkspace(key);
}

/** Adopt a server document (a fetch or a 409) and replay the pending ops on it. */
export function adoptServer(key: string, rev: number, payload: unknown): void {
  const s = workspaceState(key);
  s.base = normalizeWorkspace(payload);
  s.rev = rev;
  s.doc = rebase(s.base, s.pending);
  saveJson(localStorage, storageKeys.workspace(key), { rev, payload: s.base });
  notifyWorkspace(key);
}

/** The first `n` pending ops were written as `payload` at `rev`. */
export function confirmWrite(key: string, n: number, rev: number, payload: WorkspaceDoc): void {
  const s = workspaceState(key);
  s.base = payload;
  s.rev = rev;
  s.pending = s.pending.slice(n);
  saveJson(localStorage, storageKeys.workspace(key), { rev, payload });
}

/** Forget a document (a deleted comparison). */
export function dropWorkspace(key: string): void {
  states.delete(key);
  try {
    localStorage.removeItem(storageKeys.workspace(key));
  } catch {
    /* ignore */
  }
  notifyWorkspace(key);
}
