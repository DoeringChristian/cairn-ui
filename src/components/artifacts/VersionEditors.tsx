import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../api/client";
import {
  useCanEdit,
  useDeleteArtifactFamily,
  useDeleteArtifactVersion,
  useVersionEdits,
} from "../../api/artifact-hooks";
import type { ArtifactFamilyDetail, ArtifactVersionInfo } from "../../api/types";
import { aliasError, isRemovableAlias, tagError } from "../../lib/artifacts/refs";
import Markdown from "../../lib/markdown";
import ChipEditor from "./ChipEditor";
import ConfirmDialog from "./ConfirmDialog";

/** Aliases of a version: `latest` is shown but never removable; `latest`/`vN` cannot be added. */
export function AliasesEditor({ version }: { version: ArtifactVersionInfo }) {
  const edits = useVersionEdits(version.id);
  const canEdit = useCanEdit();
  return (
    <ChipEditor
      label="alias"
      testId="aliases-editor"
      values={version.aliases}
      editable={canEdit}
      isRemovable={isRemovableAlias}
      validate={aliasError}
      onAdd={(a) => edits.addAlias.mutate(a)}
      onRemove={(a) => edits.removeAlias.mutate(a)}
      pending={edits.addAlias.isPending || edits.removeAlias.isPending}
      error={edits.addAlias.error ?? edits.removeAlias.error}
      chipClass="border-accent/40 bg-accent/5 text-accent"
    />
  );
}

export function TagsEditor({ version }: { version: ArtifactVersionInfo }) {
  const edits = useVersionEdits(version.id);
  const canEdit = useCanEdit();
  return (
    <ChipEditor
      label="tag"
      testId="tags-editor"
      values={version.tags}
      editable={canEdit}
      validate={tagError}
      onAdd={(t) => edits.addTag.mutate(t)}
      onRemove={(t) => edits.removeTag.mutate(t)}
      pending={edits.addTag.isPending || edits.removeTag.isPending}
      error={edits.addTag.error ?? edits.removeTag.error}
    />
  );
}

/** The version's description: markdown (the shared pipeline), edited as text. */
export function DescriptionEditor({ version, compact = false }: { version: ArtifactVersionInfo; compact?: boolean }) {
  const edits = useVersionEdits(version.id);
  const canEdit = useCanEdit();
  const current = version.description ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);
  if (editing) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          edits.update.mutate({ description: draft }, { onSuccess: () => setEditing(false) });
        }}
      >
        <textarea
          autoFocus
          className="input min-h-[5rem] resize-y text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="description"
          placeholder="What is in this version? (markdown)"
        />
        <div className="flex items-center gap-2">
          <button type="submit" className="btn px-2 py-0.5 text-xs" disabled={edits.update.isPending}>
            Save
          </button>
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            onClick={() => {
              setDraft(current);
              setEditing(false);
            }}
          >
            Cancel
          </button>
          {edits.update.isError && <span className="text-xs text-status-failed">{errorText(edits.update.error)}</span>}
        </div>
      </form>
    );
  }
  return (
    <div className="group/desc flex items-start gap-2" data-testid="description">
      <div className={`min-w-0 flex-1 text-sm ${compact ? "line-clamp-4" : ""}`}>
        {current.trim() ? <Markdown>{current}</Markdown> : <span className="text-fg-subtle">No description.</span>}
      </div>
      {canEdit && (
        <button
          type="button"
          className="btn shrink-0 px-2 py-0.5 text-xs"
          onClick={() => setEditing(true)}
          aria-label="edit description"
        >
          <i className="fa-solid fa-pen" aria-hidden="true" /> Edit
        </button>
      )}
    </div>
  );
}

/**
 * Delete one version: the API refuses (409) while an alias names it; the
 * dialog then shows the server's reason and offers "Delete anyway" (force).
 */
export function DeleteVersionDialog({
  version,
  open,
  onClose,
  onDeleted,
}: {
  version: ArtifactVersionInfo;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const del = useDeleteArtifactVersion();
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setConflict(null);
      del.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const run = (force: boolean) =>
    del.mutate(
      { id: version.id, force },
      {
        onSuccess: () => {
          onClose();
          onDeleted();
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) setConflict(e.detail ?? e.message);
        },
      },
    );
  const otherError = del.error && !(del.error instanceof ApiError && del.error.status === 409) ? errorText(del.error) : null;
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={`Delete ${version.ref}?`}
      confirmLabel={conflict ? "Delete anyway" : "Delete version"}
      onConfirm={() => run(conflict !== null)}
      pending={del.isPending}
      error={
        conflict ? (
          <>
            <p className="font-semibold">The server refused: {conflict}</p>
            <p className="mt-1">
              Deleting anyway drops its aliases
              {version.aliases.includes("latest") ? " and moves latest to the newest remaining version" : ""}.
            </p>
          </>
        ) : (
          otherError
        )
      }
    >
      <p>
        This removes <span className="mono">{version.qualified_ref}</span>: its file list, aliases and the
        record of the runs that used it. The files' bytes stay (other versions may share them). Version
        numbers are never reused.
      </p>
      {version.aliases.length > 0 && (
        <p className="text-xs text-fg-muted">
          Aliases on it: <span className="mono">{version.aliases.join(", ")}</span>
        </p>
      )}
    </ConfirmDialog>
  );
}

export function DeleteFamilyDialog({
  family,
  open,
  onClose,
  onDeleted,
}: {
  family: Pick<ArtifactFamilyDetail, "id" | "name" | "version_count" | "versions">;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const del = useDeleteArtifactFamily();
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={`Delete artifact ${family.name}?`}
      confirmLabel="Delete artifact"
      requireText={family.name}
      onConfirm={() =>
        del.mutate({ id: family.id, name: family.name, versionIds: family.versions.map((v) => v.id) }, {
          onSuccess: () => {
            onClose();
            onDeleted();
          },
        })
      }
      pending={del.isPending}
      error={del.isError ? errorText(del.error) : null}
    >
      <p>
        This deletes <span className="mono">{family.name}</span> and all {family.version_count} of its versions,
        with their aliases and usage records. It cannot be undone.
      </p>
    </ConfirmDialog>
  );
}
