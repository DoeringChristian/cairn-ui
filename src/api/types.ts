// Types mirroring the Cairn server's response shapes.
// Keep loose: these are what the frontend needs, not full schema validation.

export type RunStatus = "running" | "completed" | "failed" | "killed" | "archived";

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
}

export interface Param {
  key: string;
  value: string; // JSON string
  value_type: string;
}

export interface SequenceMeta {
  name: string;
  object_type: string;
  context: string | null;
  context_hash: string;
  min_step: number;
  max_step: number;
  count: number;
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
  context: string | null;
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

/** A `/updates` point: a sequence point plus the keys that route it to a card. */
export interface UpdatePoint extends SequencePoint {
  name: string;
  context_hash: string;
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

export interface RunDetailResponse {
  run: Run;
  params: Param[];
}

/** Per-run extras `GET /api/runs` adds on request (`?include=`). */
export type RunInclude = "params";

/** Filters and paging for `GET /api/runs`. */
export interface RunsQuery {
  project?: string;
  status?: string;
  group?: string;
  job_type?: string;
  sweep_id?: string;
  include?: RunInclude[];
  limit?: number;
  offset?: number;
}

export interface RunsListResponse {
  runs: Run[];
  total: number;
  limit: number;
  offset: number;
}

export interface ArtifactSummary {
  name: string;
  hash: string;
  step: number | null;
  created_at?: string;
  mime_type: string;
  size_bytes: number;
  metadata: string | null;
  object_type?: string;
}

export interface ArtifactsResponse {
  named: ArtifactSummary[];
  from_sequences: ArtifactSummary[];
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
  latest_version: number | null;
  total_versions: number;
  total_size: number;
  aliases: string[];
}

export interface ArtifactVersionInfo {
  id: string;
  family_id: string;
  version: number;
  hash: string;
  size_bytes: number;
  metadata: string | null;
  created_at: string;
  created_by_run: string | null;
}

export interface ArtifactFamilyDetail extends ArtifactFamily {
  versions: ArtifactVersionInfo[];
}

export interface LineageNode {
  id: string;
  type: "artifact_version" | "run";
  // Artifact version fields (present when type === "artifact_version")
  family_id?: string;
  family_name?: string;
  version?: number;
  // Run fields: label is the display name (absent for a deleted run — the
  // page falls back to the id), metadata.status the run status.
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface LineageEdge {
  source: string;
  target: string;
  /** `forked`: run → run, the target was forked from the source. */
  relation: "produced" | "consumed" | "forked";
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface RunArtifactInput {
  artifact_version_id: string;
  family_id: string;
  family_name: string;
  version: number;
  role: string | null;
}

export interface RunArtifactOutput {
  artifact_version_id: string;
  family_id: string;
  family_name: string;
  version: number;
}
