import { useMemo, useState } from "react";
import ChangedFileList from "../components/code-diff/ChangedFileList";
import DiffView from "../components/code-diff/DiffView";
import { useSourceFilePair, useSourceTrees } from "../components/code-diff/use-source-diff";
import { disambiguateRunLabels, shortRunId, useRunMetadataVersion } from "../lib/run-label";

interface Props {
  compRunIds: string[];
}

export default function ComparisonSourceTab({ compRunIds }: Props) {
  // Recompute labels when the run metadata cache is seeded (api/hooks.ts).
  const metaVersion = useRunMetadataVersion();
  const labels = useMemo(
    () => disambiguateRunLabels(compRunIds),
    [compRunIds, metaVersion],
  );

  const [rawLeftId, setLeftId] = useState<string>("");
  const [rawRightId, setRightId] = useState<string>("");
  const leftId = compRunIds.includes(rawLeftId) ? rawLeftId : (compRunIds[0] ?? "");
  const rightId = compRunIds.includes(rawRightId) ? rawRightId : (compRunIds[1] ?? compRunIds[0] ?? "");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const trees = useSourceTrees(leftId, rightId);
  const status = trees.files.find((f) => f.path === selectedFile)?.status ?? null;
  const pair = useSourceFilePair(leftId, rightId, selectedFile, status);

  if (compRunIds.length < 2) {
    return (
      <p className="text-sm text-fg-muted">
        Add at least 2 runs to this comparison to diff their source snapshots.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Run pair selector */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-fg-muted">Left:</span>
          <select
            className="input py-0.5 text-xs"
            value={leftId}
            onChange={(e) => { setLeftId(e.target.value); setSelectedFile(null); }}
          >
            {compRunIds.map((id) => (
              <option key={id} value={id}>
                {labels[id] ?? shortRunId(id)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-fg-muted">Right:</span>
          <select
            className="input py-0.5 text-xs"
            value={rightId}
            onChange={(e) => { setRightId(e.target.value); setSelectedFile(null); }}
          >
            {compRunIds.map((id) => (
              <option key={id} value={id}>
                {labels[id] ?? shortRunId(id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {trees.loading ? (
        <p className="text-fg-muted">Loading source trees...</p>
      ) : trees.missing ? (
        <p className="text-fg-muted">
          One or both runs do not have a source snapshot.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
          {/* File list */}
          <aside className="card max-h-[30vh] overflow-auto p-3 md:max-h-[70vh]">
            <ChangedFileList
              files={trees.changed}
              total={trees.files.length}
              selected={selectedFile}
              onSelect={setSelectedFile}
            />
          </aside>

          {/* Diff viewer */}
          <main className="card max-h-[70vh] overflow-auto p-4">
            {!selectedFile ? (
              <p className="text-fg-muted">Pick a file on the left.</p>
            ) : pair.loading ? (
              <p className="text-fg-muted">Loading...</p>
            ) : (
              <DiffView
                left={pair.left}
                right={pair.right}
                leftLabel={labels[leftId] ?? shortRunId(leftId)}
                rightLabel={labels[rightId] ?? shortRunId(rightId)}
                path={selectedFile}
                layout="unified"
                context={null}
              />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
