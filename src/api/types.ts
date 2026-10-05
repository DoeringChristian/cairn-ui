// Types mirroring the Cairn server's response shapes.
// Keep loose: these are what the frontend needs, not full schema validation.

export type RunStatus = "running" | "completed" | "failed" | "killed" | "stopped";

export interface Health {
  status: string;
  version: string;
  uptime_sec: number;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  description: string | null;
  tags: string | null;
  run_count: number;
  active_run_count: number;
  last_run_at: string | null;
}

export interface Run {
  id: string;
  project_id: string;
  display_name: string | null;
  created_at: string;
  ended_at: string | null;
  status: RunStatus;
  exit_code: number | null;
  git_sha: string | null;
  git_dirty: boolean | null;
  git_branch: string | null;
  cli_args: string | null; // stored as JSON string
  env_snapshot: string | null; // JSON string
  hostname: string | null;
  user: string | null;
  tags: string | null; // JSON string
  notes: string | null;
  git_remote: string | null;
  /** The run this one was forked from, and the step it was forked at. */
  parent_run_id: string | null;
  fork_step: number | null;
  /**
   * Bumped whenever the run's history is rewritten (rewind); a live client's
   * rowid cursor for the run is stale once this changes.
   */
  data_epoch: number;
  /** Free-form grouping label (e.g. one per ablation arm). */
  group: string | null;
  job_type: string | null;
  sweep_id: string | null;
  /** When a stop was requested from the UI; null when none is pending. */
  stop_requested: string | null;
  /** When the run was archived; null when it is not. Archiving never changes `status`. */
  archived_at: string | null;
  archived: boolean;
  /**
   * The run's config as `{key: value}` (dotted keys, values JSON-decoded).
   * Only present when the list was fetched with `include: ["params"]`.
   */
  params?: Record<string, unknown>;
  /**
   * What the run table shows as metric columns: each scalar sequence's LAST
   * point, with an explicit `run.summary()` key of the same name replacing it.
   * Resolved server-side per page; absent on endpoints that do not compute it.
   */
  values?: Record<string, number | string | boolean | null>;
  // --- wave 2 / B: per-metric stats (GET /api/runs/{id}; /api/runs?include=stats) ---
  /** Per scalar metric: count, first/last (by step), min/max/mean, step span, rule. */
  stats?: Record<string, RunMetricStats>;
}

// --- wave 2 / B: per-metric stats ---
/** One metric's `run.stats` entry (the server's `_metric_stats`). */
export interface RunMetricStats {
  count: number;
  first: number | null;
  last: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  first_step: number;
  last_step: number;
  /** The metric's summary rule (min|max|mean|last), or null. */
  rule: string | null;
}

export interface Param {
  key: string;
  value: string; // JSON string
  value_type: string;
}

export interface SequenceMeta {
  name: string;
  object_type: string;
  min_step: number;
  max_step: number;
  count: number;
  /** Custom data (`object_type: "custom"`): the kind of the latest point (`guiding/vmf`). */
  kind?: string | null;
}

export interface SequencePoint {
  step: number;
  wall_time: string;
  scalar_value: number | null;
  artifact_hash: string | null;
  /** MIME type of the artifact (null for scalar rows). */
  artifact_mime?: string | null;
  /** Byte size of the artifact (null for scalar rows). */
  artifact_size?: number | null;
  /** JSON-stringified handler-specific metadata (null for scalar rows). */
  artifact_metadata?: string | null;
  object_type: string;
  /** JSON-stringified per-point metadata (e.g. a caption); null when none. */
  metadata?: string | null;
}

export interface SequenceResponse {
  run_id: string;
  name: string;
  points: SequencePoint[];
  /**
   * Append cursor (max rowid) covering these points. Seeds the live-updates
   * poller so it resumes past what this response already delivered.
   */
  cursor?: number;
  /** The run's data epoch the cursor belongs to (see `Run.data_epoch`). */
  data_epoch?: number;
}

/** A `/updates` point: a sequence point plus the name that routes it to a card. */
export interface UpdatePoint extends SequencePoint {
  name: string;
}

/** One poll of `GET /api/runs/{id}/updates?since=<cursor>`. */
export interface UpdatesResponse {
  run_id: string;
  status: RunStatus;
  /** The run's data epoch; a change means the history was rewound. */
  data_epoch: number;
  /** Pass back as `since` on the next poll. */
  cursor: number;
  points: UpdatePoint[];
  /** The server's LIMIT was hit — poll again immediately. */
  more: boolean;
}

/** A metric's rule, set with `run.track(..., summary=..., x=...)`; `name` is exact. */
export interface MetricDef {
  name: string;
  /** The full name of the scalar series cards plot this metric against. */
  x: string | null;
  /** The run table's value for it: "min" | "max" | "mean" | "last". */
  summary: string | null;
}

export interface RunDetailResponse {
  run: Run;
  params: Param[];
  /** Keys set with `run.summary(...)` (same shape as params). */
  summary?: Param[];
  metric_defs?: MetricDef[];
  /** The config as logged (nested); `params` is its flat index. */
  config_doc?: Record<string, unknown>;
  /** The summary as logged (nested); `summary` is its flat index. */
  summary_doc?: Record<string, unknown>;
}

/** Per-run extras `GET /api/runs` adds on request (`?include=`). */
export type RunInclude = "params" | "stats";

/** Filters and paging for `GET /api/runs`. */
export interface RunsQuery {
  project?: string;
  status?: string;
  group?: string;
  job_type?: string;
  sweep_id?: string;
  /** Only these runs (the runs list's live poll). */
  ids?: string[];
  include?: RunInclude[];
  /** Archived runs: "all" (the default here; the runs table hides them itself), "false" or "true". */
  archived?: "all" | "false" | "true";
  /** Order key (server default `created_at`) and direction (default here: newest first). */
  sort?: string;
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export interface RunsListResponse {
  runs: Run[];
  total: number;
  limit: number;
  offset: number;
}

export type AlertLevel = "info" | "warn" | "error";

/** A run alert (``run.alert()``, a failed/killed run) — GET /api/projects/{id}/alerts. */
export interface Alert {
  id: string;
  run_id: string;
  run_name: string | null;
  level: AlertLevel;
  title: string;
  text: string;
  created_at: string;
  /** When the server's webhook task claimed it; null = not (yet) sent. */
  delivered_at: string | null;
}

export interface LogLine {
  stream: "stdout" | "stderr";
  wall_time: string;
  line_no: number;
  content: string;
}

export interface LogsResponse {
  lines: LogLine[];
  total: number;
  offset: number;
  limit: number;
}

export interface SourceTreeFile {
  path: string;
  size: number;
  sha256: string;
}

export interface SourceTreeResponse {
  root: string;
  captured_at: string;
  files: SourceTreeFile[];
  skipped: Array<{ path: string; reason: string }>;
  marker?: string | null;
  /** Blob of the `git diff HEAD` of a dirty working tree (`/api/artifacts/{hash}`). */
  diff_hash?: string | null;
}

export interface SourceFileResponse {
  path: string;
  encoding: "utf-8" | "base64";
  content: string;
}

export interface ArtifactFamily {
  id: string;
  project_id: string;
  name: string;
  type: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  latest_version: number;
  version_count: number;
  /** Bytes of the uploaded entries of every version (references excluded). */
  total_size: number;
  /** alias -> version number; `latest` always names the newest version. */
  aliases: Record<string, number>;
}

/** A run as the registry and lineage graphs reference it. */
export interface ArtifactRunRef {
  id: string;
  /** Null when the run was deleted. */
  name: string | null;
  status: RunStatus | null;
  project_id: string | null;
  created_at: string | null;
  archived: boolean;
}

/** One artifact version (`GET /api/artifact-versions/{id}`). */
export interface ArtifactVersionInfo {
  id: string;
  family_id: string;
  project_id: string;
  name: string;
  type: string;
  version: number;
  /** `name:vN`. */
  ref: string;
  /** `project/name:vN`. */
  qualified_ref: string;
  /** The manifest's sha256. */
  digest: string;
  /** Bytes of the uploaded entries (references excluded). */
  size: number;
  file_count: number;
  ref_count: number;
  metadata: Record<string, unknown>;
  description: string | null;
  step: number | null;
  created_at: string;
  /** `latest` first, then the user aliases. */
  aliases: string[];
  tags: string[];
  created_by_run: string | null;
  producer: ArtifactRunRef | null;
  consumer_count: number;
  /** Present when asked for (`/runs/{id}/outputs?include=files`). */
  files?: ArtifactEntryInfo[];
}

/** One entry of a version: an uploaded file (`digest`) or a reference (`uri`). */
export interface ArtifactEntryInfo {
  path: string;
  size: number | null;
  digest: string | null;
  mime: string | null;
  /** The cairn type a reader decodes it with (`pickle`, `image`, ...); null for a plain file. */
  object_type: string | null;
  uri: string | null;
  etag: string | null;
  meta: Record<string, unknown>;
}

export interface ArtifactConsumer {
  run: ArtifactRunRef;
  role: string;
  used_at: string;
}

export interface ArtifactFamilyDetail extends ArtifactFamily {
  versions: ArtifactVersionInfo[];
}

/** Shared by every lineage node: in/out degree within the returned graph and
 * the sibling-set key (null when the node has no siblings). */
interface LineageNodeBase {
  id: string;
  label: string;
  degree: { in: number; out: number };
  /** Produced/consumed edges in the whole repo (more than `degree`: there is more to expand). */
  full_degree?: { in: number; out: number };
  group_key: string | null;
}

export interface LineageVersionNode extends LineageNodeBase {
  kind: "artifact_version";
  /** The artifact type (`model`, `dataset`, ...). */
  type: string;
  name: string;
  family_id: string;
  project_id: string;
  version: number;
  ref: string;
  qualified_ref: string;
  aliases: string[];
  tags: string[];
  step: number | null;
  created_at: string;
  file_count: number;
  size: number;
}

export interface LineageRunNode extends LineageNodeBase {
  kind: "run";
  name: string | null;
  status: RunStatus | null;
  tags: string[];
  group: string | null;
  job_type: string | null;
  project_id: string | null;
  created_at: string | null;
  archived: boolean;
  /** The run no longer exists (its edges keep an endpoint). */
  deleted: boolean;
}

/** A collapsed sibling set (`?cluster=N`). */
export interface LineageGroupNode {
  kind: "group";
  id: string;
  label: string;
  group_key: string;
  member_kind: "run" | "artifact_version";
  count: number;
  members: string[];
}

export type LineageNode = LineageVersionNode | LineageRunNode | LineageGroupNode;

export interface LineageEdge {
  source: string;
  target: string;
  /** produced: run -> version; consumed: version -> run (with `role`); forked: run -> run. */
  kind: "produced" | "consumed" | "forked";
  role?: string;
  /** With clustering: how many member edges this edge stands for. */
  count?: number;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
  /** Every sibling set, collapsed or not. */
  groups: Array<{ group_key: string; member_kind: "run" | "artifact_version"; members: string[] }>;
  /** The id the graph is centred on (version- and run-centred queries). */
  center?: string;
}

/** A consumed version, with how it was used. */
export interface RunArtifactInput extends ArtifactVersionInfo {
  role: string;
  used_at: string;
}

// ---- Sweeps ------------------------------------------------------------------

export type SweepStatus = "running" | "paused" | "cancelled" | "finished";
export type SweepMethod = "grid" | "random" | "bayes";

/** One claimed set of params and its outcome (`GET /api/sweeps/{id}`). */
export interface SweepTrial {
  id: string;
  sweep_id: string;
  /** The first run that joined the trial; null until one does. */
  run_id: string | null;
  params: Record<string, unknown>;
  /** "running", then how the trial ended ("completed", "failed", "killed"). */
  status: string;
  value: number | null;
  created_at: string;
}

export interface Sweep {
  id: string;
  project_id: string;
  name: string | null;
  method: SweepMethod;
  /** The search space as created (wandb's `parameters` block). */
  space: Record<string, unknown>;
  metric: string | null;
  goal: "minimize" | "maximize";
  command: string | null;
  status: SweepStatus;
  created_at: string;
  trial_count: number;
  /** Trial count per trial status. */
  counts: Record<string, number>;
  /** The best completed trial by metric and goal. */
  best: SweepTrial | null;
}

export interface SweepDetail extends Sweep {
  trials: SweepTrial[];
}

export type SweepAction = "pause" | "resume" | "cancel";

// ── Project workspace + saved views (server: routes/project_docs.py) ────

/** A comparison as listed (routes/project_docs.py). */
export interface ComparisonSummary {
  id: string;
  name: string;
  rev: number;
  created_at: string;
  updated_at: string;
  run_count: number;
}

export interface WorkspaceGet {
  /** 0 (with a null payload) before the first save. */
  rev: number;
  updated_at: string | null;
  payload: Record<string, unknown> | null;
}

export type WorkspacePutResult =
  | { ok: { rev: number; updated_at: string }; conflict?: undefined }
  | { ok?: undefined; conflict: { rev: number; payload: Record<string, unknown> | null } };

export interface SavedViewSummary {
  id: string;
  name: string;
  rev: number;
  created_at: string;
  updated_at: string;
}

export interface SavedView extends SavedViewSummary {
  project_id: string;
  payload: Record<string, unknown>;
}

// ── Report share links (server: routes/shares.py) — wave 3 / I ──────────

/** A share link as listed (the secret is never listed). */
export interface ReportShare {
  id: string;
  report_id: string;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: "active" | "expired" | "revoked";
}

/** A freshly created share: `secret`/`url` are returned this once only. */
export interface ReportShareCreated {
  id: string;
  report_id: string;
  secret: string;
  /** Path of the link, `/share/<secret>`. */
  url: string;
  created_at: string;
  expires_at: string;
}

/** `GET /api/share/context`: everything a share viewer's page needs. */
export interface ShareContext {
  report: {
    id: string;
    project_id: string;
    name: string;
    created_at: string;
    updated_at: string;
    payload: Record<string, unknown>;
  };
  expires_at: string;
  /** The report's runs (no environment), newest first. */
  runs: Run[];
  /** Each run's sequence roster, as `GET /api/runs/{id}/sequences` lists it. */
  metric_index: Record<string, SequenceMeta[]>;
  /** Runs whose source files a code-diff card may show. */
  source_run_ids: string[];
}

// ── Report editing: conflicts, assets, comments (wave 3, agent H) ────────
// Server: routes/reports.py (expected_updated_at), report_assets.py, report_comments.py.

export type ReportPutResult =
  | { ok: { id: string; updated_at: string }; conflict?: undefined }
  | { ok?: undefined; conflict: { name: string; updated_at: string; payload: Record<string, unknown> } };

export interface ReportAsset {
  hash: string;
  mime_type: string;
  size_bytes: number;
  /** `cairn-asset:<hash>`, what the markdown references. */
  ref: string;
  url: string;
}

export interface ReportComment {
  id: string;
  report_id: string;
  /** The thread root's id on a reply; null on a root. */
  parent_id: string | null;
  anchor_kind: "report" | "block" | "card" | "quote";
  anchor_id: string | null;
  quote: string | null;
  body: string;
  author_id: string | null;
  author: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  /** The caller may edit or delete it. */
  can_edit: boolean;
}

export interface ReportCommentCreate {
  body: string;
  anchor_kind?: ReportComment["anchor_kind"];
  anchor_id?: string | null;
  quote?: string | null;
  parent_id?: string | null;
}

// ── Custom viewers (server: GET /api/projects/{id}/viewers) ────────────

/** One custom viewer as listed: its normalized manifest plus where its files are. */
export interface ViewerInfo {
  name: string;
  title: string;
  entry: string;
  accepts: string[];
  inputs: "single" | "compare";
  webgl: boolean;
  view: boolean;
  settings: unknown[];
  imports: Record<string, string>;
  description?: string | null;
  /** Font Awesome solid icon name for the card builder (manifest `icon`). */
  icon?: string | null;
  /** A live `cairn viewer dev` source (preferred over the published one while it exists). */
  dev: boolean;
  /** The published version (null for a dev source). */
  version_id: string | null;
  version: number | null;
  digest: string | null;
  content_digest: string;
  /** Dev sources: bumps on every change. */
  revision?: number;
  updated_at: string;
  /** Dev sources: why the folder's manifest is invalid right now. */
  error: string | null;
}

/** One file of a viewer (a dev source's file list). */
export interface ViewerFileInfo {
  path: string;
  size: number;
  digest: string;
  mime: string;
}
