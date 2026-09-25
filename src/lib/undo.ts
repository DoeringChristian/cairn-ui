/**
 * An undo/redo stack (pure).
 *
 * Each entry carries its own `undo` / `redo` closures. Entries pushed with the
 * same `mergeKey` within `MERGE_WINDOW_MS` of the previous one coalesce into
 * that entry (a slider drag is one step): the merged entry keeps the oldest
 * `undo` and the newest `redo`. A push clears the redo branch. The stack keeps
 * at most `UNDO_CAP` entries, dropping the oldest.
 */

export const MERGE_WINDOW_MS = 600;
export const UNDO_CAP = 200;

export interface UndoEntry {
  /** Human-readable description, e.g. "Change smoothing". */
  label: string;
  undo: () => void;
  redo: () => void;
  /** Entries sharing a merge key within the merge window coalesce. */
  mergeKey?: string;
}

interface StoredEntry extends UndoEntry {
  /** Time of the latest push folded into this entry. */
  at: number;
}

export class UndoStack {
  private past: StoredEntry[] = [];
  private future: StoredEntry[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private readonly now: () => number;
  private readonly cap: number;
  private readonly mergeWindowMs: number;

  constructor(now: () => number = () => Date.now(), cap: number = UNDO_CAP, mergeWindowMs: number = MERGE_WINDOW_MS) {
    this.now = now;
    this.cap = cap;
    this.mergeWindowMs = mergeWindowMs;
  }

  push(entry: UndoEntry): void {
    const at = this.now();
    this.future = [];
    const top = this.past[this.past.length - 1];
    if (
      top &&
      entry.mergeKey !== undefined &&
      top.mergeKey === entry.mergeKey &&
      at - top.at <= this.mergeWindowMs
    ) {
      this.past[this.past.length - 1] = { ...top, redo: entry.redo, label: entry.label, at };
    } else {
      this.past.push({ ...entry, at });
      if (this.past.length > this.cap) this.past.splice(0, this.past.length - this.cap);
    }
    this.emit();
  }

  /** Undo the latest entry. Returns its label, or null when there is none. */
  undo(): string | null {
    const e = this.past.pop();
    if (!e) return null;
    e.undo();
    // A later push must never merge into an entry that was undone and redone.
    this.future.push({ ...e, at: -Infinity });
    this.emit();
    return e.label;
  }

  /** Redo the latest undone entry. Returns its label, or null when there is none. */
  redo(): string | null {
    const e = this.future.pop();
    if (!e) return null;
    e.redo();
    this.past.push({ ...e, at: -Infinity });
    this.emit();
    return e.label;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get size(): number {
    return this.past.length;
  }

  /** Label of the entry `undo()` would revert. */
  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.emit();
  }

  /** Bumped on every change; a snapshot for `useSyncExternalStore`. */
  getVersion = (): number => this.version;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
