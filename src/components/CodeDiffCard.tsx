/**
 * Code diff card: two runs' source snapshots (`capture_source=True`) diffed —
 * a file list (changed files, or all), a file picker, and the picked file
 * side by side or unified, folded to a few context lines around each change.
 *
 * The pair defaults to the card's first two runs and the file to the first
 * changed one; both persist once picked.
 */

import { useMemo, useRef, useState } from "react";
import { useCardSettings } from "../lib/card-settings";
import { exportChartPng, safeName } from "../lib/download";
import { disambiguateRunLabels, shortRunId, useRunMetadataVersion } from "../lib/run-label";
import { useRunColors, useVisibleRuns } from "../lib/run-view";
import { HeaderToggle } from "./card-header";
import type { CodeDiffSettings } from "./cards-settings/code-diff";
import ChangedFileList from "./code-diff/ChangedFileList";
import DiffView from "./code-diff/DiffView";
import { useSourceFilePair, useSourceTrees } from "./code-diff/use-source-diff";
import CardShell from "./CardShell";
import CodeDiffSettingsPanel from "./settings-panels/CodeDiffSettingsPanel";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

export default function CodeDiffCard({ runIds: allRunIds, settingsKey, onRemove, autoOpenSettings }: Props) {
  const ctl = useCardSettings<CodeDiffSettings>(settingsKey, "code-diff");
  const s = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const runIds = useVisibleRuns(allRunIds);
  const colors = useRunColors(allRunIds);

  const metaVersion = useRunMetadataVersion();
  const labels = useMemo(
    () => disambiguateRunLabels(allRunIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRunIds.join("|"), metaVersion],
  );
  const label = (id: string) => labels[id] ?? shortRunId(id);

  // A picked run that is no longer visible falls back to the default.
  const leftId = s.leftRunId && runIds.includes(s.leftRunId) ? s.leftRunId : (runIds[0] ?? "");
  const rightId =
    s.rightRunId && runIds.includes(s.rightRunId)
      ? s.rightRunId
      : (runIds.find((id) => id !== leftId) ?? leftId);

  // The file: the picked one while either tree has it, else the first changed.
  const trees = useSourceTrees(leftId, rightId);
  const picked = s.path ? trees.files.find((f) => f.path === s.path) : undefined;
  const file = picked ?? trees.changed[0] ?? trees.files[0] ?? null;
  const path = file?.path ?? null;
  const pair = useSourceFilePair(leftId, rightId, path, file?.status ?? null);

  const setPath = (p: string) => ctl.set({ path: p });
  const runOptions = useMemo(() => runIds.map((id) => ({ value: id, label: labels[id] ?? shortRunId(id) })), [runIds, labels]);
  const settingsPanel = <CodeDiffSettingsPanel ctl={ctl} mode="card" ctx={{ runs: runOptions, leftId, rightId }} />;
  const cardRef = useRef<HTMLDivElement>(null);

  const runLabel = (id: string) => (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors.get(id) }} />
      <span className="mono truncate">{label(id)}</span>
    </span>
  );

  const body = (className: string, listCls: string) => {
    if (runIds.length < 2) {
      return <p className={`text-sm text-fg-muted ${className}`}>Needs at least 2 runs with a source snapshot.</p>;
    }
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          {runLabel(leftId)}
          <button
            type="button"
            onClick={() => ctl.set({ leftRunId: rightId, rightRunId: leftId })}
            disabled={ctl.locked}
            className="rounded px-1 hover:bg-bg-hover hover:text-fg disabled:cursor-not-allowed"
            title="Swap before and after"
            aria-label="Swap before and after"
          >
            <i className="fa-solid fa-arrow-right-arrow-left" aria-hidden="true" />
          </button>
          {runLabel(rightId)}
          {runIds.length > 2 && (
            <button type="button" onClick={() => setExpanded(true)} className="text-fg-subtle hover:text-accent">
              change runs…
            </button>
          )}
        </div>
        {trees.loading ? (
          <p className="text-sm text-fg-muted">Loading source trees…</p>
        ) : trees.missing ? (
          <p className="text-sm text-fg-muted">
            {label(leftId)} or {label(rightId)} has no source snapshot (log with <code className="mono">capture_source=True</code>).
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3">
            <aside className={`flex min-h-0 shrink-0 flex-col border-r border-border-subtle pr-2 ${listCls}`}>
              <ChangedFileList
                files={s.onlyChanged ? trees.changed : trees.files}
                total={trees.files.length}
                selected={path}
                onSelect={setPath}
                searchFiles={trees.files}
              />
            </aside>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto">
              {!path ? (
                <p className="text-sm text-fg-muted">No files.</p>
              ) : pair.loading ? (
                <p className="text-sm text-fg-muted">Loading…</p>
              ) : (
                <DiffView
                  left={pair.left}
                  right={pair.right}
                  leftLabel={label(leftId)}
                  rightLabel={label(rightId)}
                  path={path}
                  layout={s.layout}
                  context={s.context}
                />
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <CardShell
      cardKind="code-diff"
      cardRef={cardRef}
      settings={s}
      updateSettings={ctl.set}
      title="Code Diff"
      subtitle={
        trees.files.length > 0
          ? `${trees.changed.length} changed file${trees.changed.length === 1 ? "" : "s"}`
          : `${runIds.length} run${runIds.length === 1 ? "" : "s"}`
      }
      defaultHeight={480}
      headerActions={
        <HeaderToggle
          icon="fa-table-columns"
          label="Side by side"
          pressed={s.layout === "split"}
          onToggle={() => ctl.set({ layout: s.layout === "split" ? "unified" : "split" })}
          disabled={ctl.locked}
        />
      }
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onScreenshot={() => { if (cardRef.current) exportChartPng(cardRef.current, safeName(s.title ?? "code_diff")); }}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex flex-col h-[calc(100vh-12rem)]">{body("flex-1 min-h-0", "w-72")}</div>}
    >
      {body("flex-1 min-h-0", "w-48")}
    </CardShell>
  );
}
