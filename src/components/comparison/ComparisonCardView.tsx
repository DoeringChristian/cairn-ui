import { useMemo } from "react";
import CardRenderer from "../CardRenderer";
import { isMultiRunCardType, type ComparisonCard } from "../../lib/comparisons";
import type { CardSettingsKey } from "../../lib/card-settings";
import type { SequenceMeta } from "../../api/types";

interface Props {
  card: ComparisonCard;
  /** Where this card's settings live — `cardSettingsKeyForScope` of its comparison/report/embed. */
  settingsKey: CardSettingsKey;
  /** Shows the card's remove control; omit for a read-only card. */
  onRemove?: () => void;
  /** Auto-open this card's settings and scroll to it once, on mount. */
  autoOpenSettings?: boolean;
}

/**
 * Render one ComparisonCard through CardRenderer. Multi-run cards take the
 * card's distinct run set; every other card is seeded with a placeholder
 * SequenceMeta for its first series (CardRenderer fetches the real one) and
 * overlays the rest.
 */
export default function ComparisonCardView({ card, settingsKey, onRemove, autoOpenSettings }: Props) {
  const runIds = useMemo(() => Array.from(new Set(card.series.map((s) => s.runId))), [card.series]);

  if (isMultiRunCardType(card.type)) {
    return (
      <CardRenderer
        kind="multi-run"
        cardType={card.type}
        runIds={runIds}
        settingsKey={settingsKey}
        onRemove={onRemove}
        autoOpenSettings={autoOpenSettings}
      />
    );
  }

  const primary = card.series[0];
  if (!primary) {
    return (
      <div data-cairn-card className="card p-4 text-sm text-fg-muted flex items-baseline justify-between gap-2">
        <span>Empty card.</span>
        {onRemove && (
          <button type="button" className="btn text-xs" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    );
  }

  const seedMetric: SequenceMeta = {
    name: primary.name,
    object_type: card.type,
    min_step: 0,
    max_step: 0,
    count: 0,
  };

  return (
    <CardRenderer
      runId={primary.runId}
      metric={seedMetric}
      extraSeries={card.series.slice(1)}
      controlledSeries
      onRemove={onRemove}
      settingsKeyOverride={settingsKey}
      autoOpenSettings={autoOpenSettings}
    />
  );
}
