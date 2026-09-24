/**
 * Tap-to-interact for touch devices.
 *
 * On a phone a one-finger drag over a chart, image or 3D viewport should
 * scroll the page, not pan the content. So a card starts non-interactive on
 * coarse-pointer devices, and its header shows a hand toggle that hands the
 * gestures to the content. With a mouse, content is always interactive and
 * no toggle is shown.
 *
 * `CardShell` owns the state (`useInteractState`) and provides it through
 * `InteractContext`; gesture-capturing components call `useInteract()`, which
 * both registers them with the card (so the toggle only appears on cards that
 * have something to interact with) and returns whether they may capture
 * gestures right now. Outside any card the hook returns true.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useCoarsePointer } from "./use-media-query";

export interface InteractState {
  /** Whether content may capture pointer/touch gestures. */
  interactive: boolean;
  /** Register a gesture-capturing consumer; returns its unregister function. */
  register: () => () => void;
}

export const InteractContext = createContext<InteractState | null>(null);

/**
 * Called by gesture-capturing content (charts, image panes, 3D viewports).
 * Returns whether the content may capture gestures.
 */
export function useInteract(): boolean {
  const ctx = useContext(InteractContext);
  const register = ctx?.register;
  useEffect(() => register?.(), [register]);
  return ctx ? ctx.interactive : true;
}

export interface InteractToggle {
  /** Context value for the card's content. */
  value: InteractState;
  /** Show the toggle: a touch device and at least one registered consumer. */
  available: boolean;
  /** The toggle's state (only meaningful when `available`). */
  on: boolean;
  toggle: () => void;
}

/**
 * The card side. `forceOn` makes content interactive regardless of the
 * toggle (the card's detail modal, where there is no page to scroll).
 */
export function useInteractState(forceOn = false): InteractToggle {
  const coarse = useCoarsePointer();
  const [on, setOn] = useState(false);
  const [consumers, setConsumers] = useState(0);

  const register = useCallback(() => {
    setConsumers((n) => n + 1);
    return () => setConsumers((n) => n - 1);
  }, []);

  const interactive = !coarse || on || forceOn;
  const value = useMemo(() => ({ interactive, register }), [interactive, register]);
  const toggle = useCallback(() => setOn((v) => !v), []);

  return { value, available: coarse && consumers > 0, on, toggle };
}
