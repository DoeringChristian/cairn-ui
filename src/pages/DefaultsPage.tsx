/**
 * /p/:projectId/defaults — the project's card defaults: workspace-wide per
 * card type, then any section that sets its own (edited from a section's
 * gear too). Cards inherit card → section → workspace → builtin. Also the
 * default viewer of each kind of data (ViewerDefaultsEditor).
 */

import { useParams } from "react-router-dom";
import DefaultsEditor, { cardTypeLabel } from "../components/DefaultsEditor";
import ViewerDefaultsEditor from "../components/ViewerDefaultsEditor";
import type { CardType } from "../lib/cards/card-spec";
import { useMemo } from "react";
import { useWorkspace } from "../lib/workspace/use-workspace";
import { viewRef } from "../lib/workspace/ref";
import { useViews } from "../lib/workspace/use-views";

export default function DefaultsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const current = useViews(projectId ?? null).data?.current ?? null;
  const wsRef = useMemo(() => (projectId && current ? viewRef(projectId, current) : null), [projectId, current]);
  const { doc } = useWorkspace(wsRef);
  if (!projectId || !wsRef) return null;
  const sections = Object.keys(doc.sectionDefaults).sort();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Card defaults</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Defaults for every card of a type in this project&rsquo;s current workspace view (the run page). A section&rsquo;s gear
          sets defaults for that section only, and a card&rsquo;s own settings win over both. Each comparison has its
          own defaults (its sections&rsquo; gears). Reports and shared links use the built-in defaults.
        </p>
      </div>

      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-muted">Default viewer per type</h2>
        <p className="mb-3 text-sm text-fg-muted">
          Which viewer shows each kind of data, everywhere in this project (reports and shared links too). A card can
          pin another in its settings (Viewer).
        </p>
        <ViewerDefaultsEditor projectId={projectId} />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Workspace</h2>
        <DefaultsEditor wsRef={wsRef} where={{ level: "workspace" }} />
      </section>

      {sections.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">Sections</h2>
          {sections.map((name) => {
            const types = Object.keys(doc.sectionDefaults[name] ?? {}) as CardType[];
            return (
              <details key={name} className="card p-4">
                <summary className="cursor-pointer select-none text-sm">
                  <span className="font-semibold">{name}</span>
                  <span className="ml-2 text-xs text-fg-muted">{types.map(cardTypeLabel).join(", ")}</span>
                </summary>
                <div className="mt-3">
                  <DefaultsEditor wsRef={wsRef} where={{ level: "section", section: name }} types={types} />
                </div>
              </details>
            );
          })}
        </section>
      )}
    </div>
  );
}
