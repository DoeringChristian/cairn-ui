/**
 * The card editor's host side (components/workspace/CardEditor.tsx): what a
 * workspace card's CardShell talks to. Kept apart from the editor so card
 * components import nothing of it but this.
 *
 * A card owns its enlarged content and settings panel (each card component
 * builds them); while its detail is open, `CardEditorSlots` portals both
 * into the editor's slots, keeping the card's React tree, contexts and
 * state.
 */

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SettingsTabsHostContext } from "../settings/palette/SettingsTabs";
import type { SettingsTabId } from "../settings/palette/logic";

/** What the card under the editor tells it. */
export interface CardEditorClaim {
  title: string;
  /** Close the card's detail state (the editor closes with it). */
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export interface Slots {
  card: HTMLElement | null;
  settings: HTMLElement | null;
  /** The editor's active tab among the card's own (null: Type, or a tab the card lacks). */
  tab: SettingsTabId | null;
}

export interface Host {
  /** The card `id` is open: the editor shows it. */
  claim: (id: string, info: MutableRefObject<CardEditorClaim>) => void;
  /** Its detail state closed (`close`), or the card unmounted while open (`unmount`). */
  release: (id: string, how: "close" | "unmount") => void;
  /** The claim's info changed (title, neighbours). */
  touch: () => void;
  getSlots: () => Slots;
  /** The card's settings panel shows these tabs (the editor draws them in its one tab row). */
  reportTabs: (tabs: SettingsTabId[]) => void;
  subscribeSlots: (fn: () => void) => () => void;
}

export const CardEditorHostContext = createContext<Host | null>(null);

/** Whether this card's detail opens in the workspace's card editor. */
export function useCardEditorHost(): boolean {
  return useContext(CardEditorHostContext) != null;
}

/**
 * For CardShell: while `open`, show card `id` in the editor, its enlarged
 * `content` and `settings` panel in the editor's slots. Kept in the card's
 * React tree (portals), so they keep the card's contexts and state.
 */
export function CardEditorSlots({
  id,
  open,
  title,
  onClose,
  onPrev,
  onNext,
  content,
  settings,
}: CardEditorClaim & { id: string; open: boolean; content: ReactNode; settings: ReactNode }) {
  const host = useContext(CardEditorHostContext)!;
  const info = useRef<CardEditorClaim>({ title, onClose, onPrev, onNext });
  info.current = { title, onClose, onPrev, onNext };
  // Read at cleanup: still true there when the card unmounts while open.
  const openRef = useRef(open);
  openRef.current = open;
  useLayoutEffect(() => {
    if (!open) return;
    host.claim(id, info);
    return () => host.release(id, openRef.current ? "unmount" : "close");
  }, [open, id, host]);
  const hasPrev = !!onPrev;
  const hasNext = !!onNext;
  useLayoutEffect(() => {
    if (open) host.touch();
  }, [open, host, title, hasPrev, hasNext]);
  const slots = useSyncExternalStore(host.subscribeSlots, host.getSlots);
  const tabs = useMemo(() => ({ active: slots.tab, report: host.reportTabs }), [slots.tab, host]);
  if (!open) return null;
  return (
    <>
      {slots.card && createPortal(content, slots.card)}
      {slots.settings &&
        createPortal(<SettingsTabsHostContext.Provider value={tabs}>{settings}</SettingsTabsHostContext.Provider>, slots.settings)}
    </>
  );
}
