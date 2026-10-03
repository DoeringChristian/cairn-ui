import { useState } from "react";
import { useCanEdit, useVersionEdits } from "../../api/artifact-hooks";
import { errorText } from "../../api/client";
import type { ArtifactVersionInfo } from "../../api/types";
import CodeBlock from "../../components/artifacts/CodeBlock";
import JsonTree from "../../components/artifacts/JsonTree";

/** A typed value from the editor: JSON when it parses, else the text as a string. */
export function parseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The version's metadata as a tree. Edits MERGE (the API's semantics): a key
 * is set or replaced, never removed; set it to null to clear it.
 */
export default function MetadataTab({ version }: { version: ArtifactVersionInfo }) {
  const canEdit = useCanEdit();
  const edits = useVersionEdits(version.id);
  const [editing, setEditing] = useState<{ key: string; text: string; isNew: boolean } | null>(null);
  const [raw, setRaw] = useState(false);
  const meta = version.metadata;

  const save = () => {
    if (!editing) return;
    const key = editing.key.trim();
    if (!key) return;
    edits.update.mutate({ metadata: { [key]: parseValue(editing.text) } }, { onSuccess: () => setEditing(null) });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="metadata-tab">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-fg-muted">
          {Object.keys(meta).length} top-level key{Object.keys(meta).length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setRaw((r) => !r)}>
            {raw ? "Tree" : "JSON"}
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn px-2 py-0.5 text-xs"
              onClick={() => setEditing({ key: "", text: "", isNew: true })}
            >
              + Add key
            </button>
          )}
        </div>
      </div>
      {editing && (
        <form
          className="card flex flex-col gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          data-testid="metadata-editor"
        >
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Key
            <input
              className="input mono text-sm"
              value={editing.key}
              disabled={!editing.isNew}
              autoFocus={editing.isNew}
              onChange={(e) => setEditing({ ...editing, key: e.target.value })}
              aria-label="metadata key"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Value (JSON; anything else is stored as a string)
            <textarea
              className="input mono min-h-[5rem] resize-y text-sm"
              value={editing.text}
              autoFocus={!editing.isNew}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              aria-label="metadata value"
            />
          </label>
          <p className="text-[11px] text-fg-subtle">
            Saving merges this key into the metadata; other keys are kept. Keys cannot be removed (set one to{" "}
            <code className="mono">null</code> to clear it).
          </p>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn px-2 py-0.5 text-xs" disabled={edits.update.isPending || !editing.key.trim()}>
              Save
            </button>
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {edits.update.isError && <span className="text-xs text-status-failed">{errorText(edits.update.error)}</span>}
          </div>
        </form>
      )}
      <div className="card px-3 py-2">
        {raw ? (
          <CodeBlock code={JSON.stringify(meta, null, 2)} lang="json" />
        ) : (
          <JsonTree
            value={meta}
            renderKeyActions={
              canEdit
                ? (key) => (
                    <button
                      type="button"
                      className="ml-1 text-[11px] text-fg-subtle opacity-0 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"
                      aria-label={`edit ${key}`}
                      onClick={() => setEditing({ key, text: JSON.stringify(meta[key], null, 2), isNew: false })}
                    >
                      <i className="fa-solid fa-pen" aria-hidden="true" />
                    </button>
                  )
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
