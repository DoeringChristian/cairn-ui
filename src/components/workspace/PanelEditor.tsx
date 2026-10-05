/**
 * The workspace half of a card's settings modal (the gear): what the card
 * shows and where it lives, beside the card's own settings.
 *
 * - `PanelEditorHeader` (top of the settings column): the card's title. Its
 *   section is not edited here: cards move between sections by drag & drop
 *   (the workspace grid, Manage cards).
 * - `PanelEditorData` (first in the Data tab): the card type (every
 *   compatible type, custom viewers included) and its data — picked series,
 *   an anchored regex with a live preview of its matches, or whole runs.
 *
 * Every change applies at once (lib/workspace/card-builder.ts changedPanel)
 * and is undoable like any workspace edit; a new card type remounts the card
 * and the editor reopens on it.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useViewerList } from "../../lib/custom/hooks";
import { useProjectId } from "../../lib/project-context";
import {
  compatibleTypes,
  dataLabel,
  kindLabel,
  optionKey,
  panelData,
  regexMatches,
  type BuilderData,
} from "../../lib/workspace/card-builder";
import type { PanelEditor } from "../../lib/workspace/panel-actions";
import { Segmented, Select, SettingRow, SettingsSection, TextInput } from "../settings/palette";
import { SettingsDataExtraContext } from "../settings/palette/SettingsTabs";

export function PanelEditorHeader({ editor, title }: { editor: PanelEditor; title: string }) {
  const custom = typeof editor.panel.settings.title === "string" ? editor.panel.settings.title : "";
  return (
    <div className="mb-3 space-y-2 border-b border-border pb-3" data-testid="panel-editor-header">
      <TextInput
        label="Title"
        value={custom}
        placeholder={title}
        onChange={(v) => editor.change({ title: v })}
        overridden={custom !== ""}
        onReset={() => editor.change({ title: "" })}
      />
    </div>
  );
}

export function PanelEditorData({ editor }: { editor: PanelEditor }) {
  const { panel, metrics, runCount } = editor;
  const viewers = useViewerList(useProjectId()).data ?? [];
  const data = panelData(panel);
  const key = optionKey(panel.type, panel.settings);
  const compat = useMemo(() => compatibleTypes(data, metrics, runCount, key, viewers), [data, metrics, runCount, key, viewers]);
  const [query, setQuery] = useState("");
  const [regexDraft, setRegexDraft] = useState(data.mode === "regex" ? data.regex : "");
  const regex = data.mode === "regex" && regexDraft.trim() ? regexMatches(regexDraft, metrics) : null;
  const picked = data.mode === "series" ? data.names : [];
  const setData = (d: BuilderData) => editor.change({ data: d });
  const toggle = (name: string) => setData({ mode: "series", names: picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name] });
  const q = query.trim().toLowerCase();
  const listed = [...metrics]
    .filter((m) => !q || m.name.toLowerCase().includes(q))
    .sort((a, b) => Number(picked.includes(b.name)) - Number(picked.includes(a.name)) || a.name.localeCompare(b.name));

  return (
    <SettingsSection name="Series">
      <Select
        label="Card type"
        description={compat.options.find((o) => o.key === key)?.hint}
        value={key}
        onChange={(v) => editor.change({ option: v })}
        options={compat.options.map((o) => ({ value: o.key, label: o.unavailable ? `${o.label} (${o.unavailable})` : o.label, disabled: o.unavailable != null && o.key !== key }))}
      />
      {compat.reason && <p className="text-xs text-fg-muted">{compat.reason}</p>}
      <SettingRow label="Data" description={dataLabel(data) || "nothing picked"} layout="stacked">
        <Segmented
          value={data.mode}
          onChange={(m) => setData(m === "series" ? { mode: "series", names: picked } : m === "regex" ? { mode: "regex", regex: regexDraft } : { mode: "runs" })}
          options={[
            { value: "series", label: "Series" },
            { value: "regex", label: "Regex" },
            { value: "runs", label: "Whole runs" },
          ]}
        />
      </SettingRow>
      {data.mode === "series" && (
        <div className="space-y-1" data-testid="panel-editor-series">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search series…"
            aria-label="Search series"
            className="input w-full py-1 text-sm"
          />
          <ul className="max-h-56 overflow-y-auto rounded border border-border-subtle">
            {listed.map((m) => (
              <li key={m.name}>
                <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-bg-hover" data-series={m.name}>
                  <input type="checkbox" checked={picked.includes(m.name)} onChange={() => toggle(m.name)} />
                  <span className="mono min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="shrink-0 rounded bg-bg-hover px-1 text-[10px] text-fg-muted">
                    {kindLabel(m.object_type === "custom" && m.kind ? m.kind : m.object_type)}
                  </span>
                </label>
              </li>
            ))}
            {listed.length === 0 && <li className="px-2 py-1 text-xs text-fg-muted">No series matches.</li>}
          </ul>
        </div>
      )}
      {data.mode === "regex" && (
        <div className="space-y-1">
          <input
            type="text"
            value={regexDraft}
            onChange={(e) => {
              setRegexDraft(e.target.value);
              setData({ mode: "regex", regex: e.target.value });
            }}
            placeholder="val\..*"
            aria-label="Series regex"
            className="input mono w-full py-1 text-sm"
          />
          {regex && !regex.ok ? (
            <p className="text-xs text-status-failed">{regex.error}</p>
          ) : (
            <ul className="max-h-40 overflow-y-auto text-xs" data-testid="panel-editor-regex-preview">
              {(regex?.ok ? regex.matches : []).map((m) => (
                <li key={m.name} className="mono truncate text-fg">{m.name}</li>
              ))}
              {regex?.ok && regex.matches.length === 0 && <li className="text-fg-muted">No series matches (yet).</li>}
            </ul>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

/**
 * The settings column of a workspace card's modal: the panel's header
 * (title), then the card's own settings with the panel's data and
 * type first in their Data tab — or above them when the card's settings
 * have no tabs.
 */
export function PanelEditorSettings({ editor, title, children }: { editor: PanelEditor; title: string; children: ReactNode }) {
  const [claimed, setClaimed] = useState(false);
  const data = <PanelEditorData editor={editor} />;
  const extra = useMemo(() => ({ node: data, claim: () => setClaimed(true) }), [data]);
  return (
    <div data-testid="panel-editor">
      <PanelEditorHeader editor={editor} title={title} />
      {!claimed && data}
      <SettingsDataExtraContext.Provider value={extra}>{children}</SettingsDataExtraContext.Provider>
    </div>
  );
}
