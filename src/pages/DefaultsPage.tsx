/**
 * /p/:projectId/defaults — the project's card defaults: workspace-wide per
 * card type, then any section that sets its own (edited from a section's
 * gear too). Cards inherit card → section → workspace → builtin.
 */

import { useParams } from "react-router-dom";
import DefaultsEditor, { cardTypeLabel } from "../components/DefaultsEditor";
import type { CardType } from "../lib/cards/card-spec";
import { useWorkspace } from "../lib/workspace/use-workspace";

export default function DefaultsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { doc } = useWorkspace(projectId ?? null);
  if (!projectId) return null;
  const sections = Object.keys(doc.sectionDefaults).sort();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Card defaults</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Defaults for every card of a type in this project. A section&rsquo;s gear sets defaults for that section
          only, and a card&rsquo;s own settings win over both. Reports and shared links use the built-in defaults.
        </p>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Workspace</h2>
        <DefaultsEditor projectId={projectId} where={{ level: "workspace" }} />
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
                  <DefaultsEditor projectId={projectId} where={{ level: "section", section: name }} types={types} />
                </div>
              </details>
            );
          })}
        </section>
      )}
    </div>
  );
}
