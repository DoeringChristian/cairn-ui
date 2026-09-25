/**
 * One undo stack per project (see lib/undo.ts), mounted by `ProjectLayout`.
 * ⌘Z / Ctrl+Z undoes and ⌘⇧Z / Ctrl+Shift+Z redoes while no text field has
 * focus (a text field keeps its own typing undo).
 *
 * Outside a provider (embeds) `useUndoStack()` is null and edits simply
 * record nothing.
 */

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { UndoStack, type UndoEntry } from "./undo";
import { useShortcut } from "./use-shortcut";

const UndoContext = createContext<UndoStack | null>(null);

export function UndoProvider({ children }: { children: ReactNode }) {
  // Keyed by the caller (one per project): a fresh stack per mount.
  const stack = useMemo(() => new UndoStack(), []);
  useShortcut("mod+z", () => stack.undo());
  useShortcut("mod+shift+z", () => stack.redo());
  return <UndoContext.Provider value={stack}>{children}</UndoContext.Provider>;
}

/** The project's undo stack, or null outside `UndoProvider`. */
export function useUndoStack(): UndoStack | null {
  return useContext(UndoContext);
}

/** Push an entry onto the project's stack; a no-op outside a provider. */
export function usePushUndo(): (entry: UndoEntry) => void {
  const stack = useUndoStack();
  return useMemo(() => (entry: UndoEntry) => stack?.push(entry), [stack]);
}

/** Re-renders on every stack change; for undo/redo buttons. */
export function useUndoState(): { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null } {
  const stack = useUndoStack();
  useSyncExternalStore(stack?.subscribe ?? noopSubscribe, stack?.getVersion ?? zero);
  return {
    canUndo: stack?.canUndo ?? false,
    canRedo: stack?.canRedo ?? false,
    undoLabel: stack?.undoLabel ?? null,
    redoLabel: stack?.redoLabel ?? null,
  };
}

const noopSubscribe = () => () => {};
const zero = () => 0;
