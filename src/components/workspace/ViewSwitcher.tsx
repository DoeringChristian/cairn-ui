/**
 * The workspace view switcher: the first item of the workspace toolbar. Its
 * button opens a panel of the project's views (lib/workspace/views.ts) as
 * tiles, each a schematic of its layout (lib/workspace/view-preview.ts)
 * resolved for the runs being viewed, ending in a dashed "+ New view" tile.
 *
 * - Run page (a view is open): the button names the current view; a tile
 *   switches to its view (navigation, no undo entry); "+ New view" creates a
 *   copy of the current view or an empty one and switches to it.
 * - Comparison: the button reads "Views"; a tile copies its view's layout
 *   into the comparison (an undoable edit; the runs stay); "+ New view"
 *   saves the comparison's layout as a new view.
 *
 * Tiles rename (✎, inline), duplicate (⧉) and delete (×, not the last
 * view) the same way in both.
 */

import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import Popover from "../ui/Popover";
import type { WorkspaceViewDoc } from "../../api/types";
import { useEscapeLayer } from "../../lib/use-modal-behavior";
import { layoutOf, ops, type WorkspaceDoc } from "../../lib/workspace/doc";
import type { MetricInfo } from "../../lib/workspace/layout";
import { useCurrentWorkspace } from "../../lib/workspace/use-workspace";
import { useViews, type UseViews } from "../../lib/workspace/use-views";
import { PREVIEW_COLUMNS, viewPreview, type ViewPreview } from "../../lib/workspace/view-preview";
import { canDeleteView, duplicateName, EMPTY_VIEW_LAYOUT, viewSummary } from "../../lib/workspace/views";

const TOOL_BTN =
  "inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg touch:min-h-10";
const TILE_ICON_BTN =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle touch:h-10 touch:w-10";

export default function ViewSwitcher({ metrics }: { metrics: readonly MetricInfo[] }) {
  const { ref, doc, update } = useCurrentWorkspace();
  const views = useViews(ref?.projectId ?? null);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!ref) return null;
  const runPage = ref.kind === "view";
  const current = runPage ? ref.id : null;
  const currentName = views.data?.views.find((v) => v.id === current)?.name;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${TOOL_BTN} max-w-[14rem]`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="view-switcher"
      >
        <i className="fa-solid fa-table-cells-large" aria-hidden="true" />
        <span className="truncate">{runPage ? (currentName ?? "") : "Views"}</span>
        <i className="fa-solid fa-caret-down text-[10px]" aria-hidden="true" />
      </button>
      <Popover
        open={open}
        onClose={close}
        anchorRef={anchor}
        title="Workspace views"
        titleAnchored
        closeAnchored
        width={760}
        align="start"
        bodyClassName="p-4"
      >
        {open && views.data && (
          <ViewTiles
            views={views}
            list={views.data.views}
            current={current}
            doc={doc}
            metrics={metrics}
            onPick={(v) => {
              if (runPage) {
                if (v.id !== current) void views.switchTo(v.id);
              } else {
                update(ops.replaceLayout(layoutOf(views.docOf(v.id))), { label: `Apply view “${v.name}”` });
              }
              close();
            }}
            onCreated={(id) => {
              if (!runPage) return;
              void views.switchTo(id);
              close();
            }}
            runPage={runPage}
          />
        )}
      </Popover>
    </>
  );
}

function ViewTiles({
  views,
  list,
  current,
  doc,
  metrics,
  onPick,
  onCreated,
  runPage,
}: {
  views: UseViews;
  list: WorkspaceViewDoc[];
  current: string | null;
  /** The open workspace's document (the current view, or the comparison). */
  doc: WorkspaceDoc;
  metrics: readonly MetricInfo[];
  onPick: (v: WorkspaceViewDoc) => void;
  onCreated: (id: string) => void;
  runPage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, []);
  const deletable = canDeleteView(list);

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-xs text-status-failed">{error}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3" data-testid="view-tiles">
        {list.map((v) => (
          <ViewTile
            key={v.id}
            view={v}
            // The open view's document is live (this tab's edits); others come from the list or the store.
            doc={v.id === current ? doc : views.docOf(v.id)}
            metrics={metrics}
            current={v.id === current}
            deletable={deletable}
            onPick={() => onPick(v)}
            onRename={(name) => void run(() => views.rename(v.id, name))}
            onDuplicate={() =>
              void run(() => views.create(duplicateName(v.name), layoutOf(v.id === current ? doc : views.docOf(v.id))))
            }
            onDelete={() => void run(() => views.remove(v.id))}
          />
        ))}
        <NewViewTile
          runPage={runPage}
          onCreate={(name, empty) =>
            void run(async () => {
              const id = await views.create(name, empty ? EMPTY_VIEW_LAYOUT : layoutOf(doc));
              onCreated(id);
            })
          }
        />
      </div>
    </div>
  );
}

function ViewTile({
  view,
  doc,
  metrics,
  current,
  deletable,
  onPick,
  onRename,
  onDuplicate,
  onDelete,
}: {
  view: WorkspaceViewDoc;
  doc: WorkspaceDoc;
  metrics: readonly MetricInfo[];
  current: boolean;
  deletable: boolean;
  onPick: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const preview = useMemo(() => viewPreview(doc, metrics), [doc, metrics]);
  const [renaming, setRenaming] = useState(false);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !renaming && onPick()}
      onKeyDown={(e) => {
        if (!renaming && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onPick();
        }
      }}
      aria-current={current ? "true" : undefined}
      className={`flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-bg text-left transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none ${current ? "border-accent" : "border-border"}`}
      data-testid="view-tile"
      data-view-id={view.id}
    >
      <PreviewDiagram preview={preview} />
      <div className="border-t border-border-subtle px-2 py-1.5">
        <div className="flex items-center gap-1">
          {renaming ? (
            <RenameField
              name={view.name}
              onDone={(name) => {
                setRenaming(false);
                if (name != null && name !== view.name) onRename(name);
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm text-fg" data-testid="view-name">
              {current ? "✓ " : ""}
              {view.name}
            </span>
          )}
          <button
            type="button"
            className={TILE_ICON_BTN}
            onClick={(e) => {
              stop(e);
              setRenaming(true);
            }}
            aria-label={`Rename view ${view.name}`}
            data-testid="view-rename"
          >
            <i className="fa-solid fa-pen text-[10px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={TILE_ICON_BTN}
            onClick={(e) => {
              stop(e);
              onDuplicate();
            }}
            aria-label={`Duplicate view ${view.name}`}
            data-testid="view-duplicate"
          >
            <i className="fa-solid fa-clone text-[10px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={TILE_ICON_BTN}
            onClick={(e) => {
              stop(e);
              onDelete();
            }}
            disabled={!deletable}
            aria-label={`Delete view ${view.name}`}
            data-testid="view-delete"
          >
            <i className="fa-solid fa-xmark text-[11px]" aria-hidden="true" />
          </button>
        </div>
        <div className="truncate text-[11px] text-fg-muted" data-testid="view-summary">
          {viewSummary(preview.cards, doc.autoPanels)}
        </div>
      </div>
    </div>
  );
}

/** The view's schematic: section names with rules, cards as boxes on 6 columns; the top portion when long. */
function PreviewDiagram({ preview }: { preview: ViewPreview }) {
  return (
    <div className="h-28 overflow-hidden px-2 pt-2" aria-hidden="true" data-testid="view-preview">
      <div className="flex flex-col gap-1.5">
        {preview.sections.map((s) => (
          <div key={s.name} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className="max-w-[70%] truncate text-[8px] font-semibold uppercase leading-none tracking-wide text-fg-muted">
                {s.name}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {s.rows.map((row, i) => (
              <div key={i} className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${PREVIEW_COLUMNS}, minmax(0, 1fr))` }}>
                {row.map((b) => (
                  <div
                    key={b.id}
                    className="flex h-4 items-center justify-center rounded-sm border border-border bg-bg-elevated"
                    style={{ gridColumn: `${b.x + 1} / span ${b.w}` }}
                    data-preview-type={b.type}
                    data-preview-span={b.w}
                  >
                    <i className={`fa-solid ${b.icon} text-[8px] text-fg-subtle`} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A tile's name in edit: Enter or leaving it saves, Escape keeps the old name. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input
      type="text"
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value.trim() || null);
        if (e.key === "Escape") {
          // The name edit, not the panel.
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => finish(value.trim() || null)}
      aria-label="View name"
      className="input min-w-0 flex-1 py-0.5 text-sm"
      data-testid="view-rename-input"
    />
  );
}

/**
 * The dashed "+ New view" tile (the workspace's "Add card" ghost style). It
 * turns into a name field; on the run page with "Copy of current view" /
 * "Empty (automatic panels only)" below. Enter creates, Escape cancels.
 */
function NewViewTile({ runPage, onCreate }: { runPage: boolean; onCreate: (name: string, empty: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [empty, setEmpty] = useState(false);
  const cancel = () => {
    setEditing(false);
    setName("");
    setEmpty(false);
  };
  useEscapeLayer(editing, cancel);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onCreate(n, runPage && empty);
    cancel();
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex min-h-[10rem] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-sm text-fg-muted transition-colors hover:border-accent hover:text-fg focus-visible:border-accent focus-visible:text-fg"
        data-testid="view-new"
      >
        <i className="fa-solid fa-plus text-lg" aria-hidden="true" />
        New view
      </button>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="flex min-h-[10rem] flex-col justify-center gap-2 rounded-lg border-2 border-dashed border-accent p-3 text-xs text-fg-muted"
      data-testid="view-new-form"
    >
      <input
        type="text"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        aria-label="View name"
        className="input w-full py-1 text-sm"
        data-testid="view-new-name"
      />
      {runPage && (
        <>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="new-view-from" checked={!empty} onChange={() => setEmpty(false)} data-testid="view-new-copy" />
            Copy of current view
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="new-view-from" checked={empty} onChange={() => setEmpty(true)} data-testid="view-new-empty" />
            Empty (automatic panels only)
          </label>
        </>
      )}
    </form>
  );
}
