/**
 * A card with nothing to draw (its runs do not log its metric, too few runs
 * for a comparison card, every run hidden): its header — with Settings,
 * which opens the type's full settings — and why it is empty. The card's
 * size comes from its settings, so the grid does not reflow while flipping
 * runs.
 */

import { downloadCsv, safeName } from "../../lib/download";
import { useRef, useState } from "react";
import { useCardSettings, type CardSettingsKey } from "../../lib/card-settings";
import type { CardType } from "../../lib/cards/card-spec";
import type { BaseCardSettings } from "./base-settings";
import CardShell from "../CardShell";
import TypeSettingsPanel from "./TypeSettingsPanel";

export default function EmptyCard({
  type,
  settingsKey,
  title,
  message,
  onRemove,
  autoOpen,
}: {
  type: CardType;
  settingsKey: CardSettingsKey;
  title: string;
  message: string;
  onRemove?: () => void;
  /** Open the settings at once (a card just added or picked to edit). */
  autoOpen?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null!);
  const ctl = useCardSettings<BaseCardSettings & Record<string, unknown>>(settingsKey, type);
  const [open, setOpen] = useState(autoOpen ?? false);
  const body = <p className="py-6 text-center text-sm text-fg-muted">{message}</p>;
  return (
    <CardShell
      cardKind={type}
      cardRef={cardRef}
      settings={ctl.value}
      updateSettings={ctl.set}
      title={title}
      onRemove={onRemove}
      // Nothing is logged: the data is an empty table.
      onDownload={() => downloadCsv(["run", "metric", "step", "value"], [], `${safeName(title)}.csv`)}
      onSettings={() => setOpen(true)}
      settingsPanel={<TypeSettingsPanel type={type} ctl={ctl} />}
      modalOpen={open}
      onModalClose={() => setOpen(false)}
      modalContent={body}
    >
      <div data-cairn-empty-panel>{body}</div>
    </CardShell>
  );
}
