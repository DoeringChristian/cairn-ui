/**
 * A card type's settings panel (lib/cards/settings-panels.ts), for cards
 * that have no live data context: an empty panel ("this run does not log
 * this metric"), a single value. It renders in card mode without the
 * runtime context (panels treat it as optional); a panel that cannot is
 * shown in defaults mode instead, so the gear always opens real settings.
 */

import { Component, lazy, Suspense, useMemo, type ReactNode } from "react";
import type { SettingsController } from "../../lib/card-settings";
import type { CardType } from "../../lib/cards/card-spec";
import { SETTINGS_PANELS } from "../../lib/cards/settings-panels";

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function TypeSettingsPanel({ type, ctl }: { type: CardType; ctl: SettingsController<Record<string, unknown>> }) {
  const Panel = useMemo(() => {
    const load = SETTINGS_PANELS[type];
    return load ? lazy(load) : null;
  }, [type]);
  if (!Panel) return <p className="text-xs text-fg-muted">This card type has no settings.</p>;
  return (
    <Suspense fallback={<div className="h-24 motion-safe:animate-pulse rounded bg-bg-hover" />}>
      <Fallback fallback={<Panel ctl={ctl} mode="defaults" />}>
        <Panel ctl={ctl} mode="card" />
      </Fallback>
    </Suspense>
  );
}
