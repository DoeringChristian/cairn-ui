/**
 * Writes docs/schemas/run-set-vectors.json: run pools, run sets and the runs
 * each set resolves to by `resolveRunSet` (src/lib/run-sets.ts). cairn's
 * Python port (`cairn/server/run_sets.py`) runs the same cases. Edit the
 * pools or cases here, then: node --experimental-strip-types scripts/gen-run-set-vectors.ts
 */

import { writeFileSync } from "node:fs";
import type { Run } from "../src/api/types.ts";
import { defaultRunSet, resolveRunSet, runSetOfIds, type RunSet } from "../src/lib/run-sets.ts";

function run(
  id: string,
  created: string,
  o: Partial<Pick<Run, "display_name" | "group" | "job_type" | "version" | "status" | "tags" | "archived">> & {
    params?: Record<string, unknown>;
    values?: Record<string, unknown>;
    loss?: [number, number];
  } = {},
): Run {
  const r = {
    id,
    created_at: `2026-01-${created}+00:00`,
    display_name: o.display_name ?? null,
    group: o.group ?? null,
    job_type: o.job_type ?? null,
    version: o.version ?? null,
    status: o.status ?? "completed",
    tags: o.tags ?? null,
    archived: o.archived ?? false,
    params: o.params ?? {},
    values: o.values ?? {},
    stats: o.loss
      ? { loss: { count: 2, first: o.loss[1], last: o.loss[0], min: o.loss[0], max: o.loss[1], mean: (o.loss[0] + o.loss[1]) / 2, first_step: 0, last_step: 1 } }
      : {},
  };
  return r as unknown as Run;
}

const main: Run[] = [
  run("r01", "01T10:00:00", { display_name: "prepare", group: "exp-44", job_type: "prepare", version: 1, params: { rows: 1000 } }),
  run("r02", "01T11:00:00", { display_name: "train", group: "exp-44", job_type: "train", version: 1, params: { lr: 0.1, opt: "adam" }, values: { acc: 0.71, loss: 0.4 }, loss: [0.4, 2], tags: '["prod"]' }),
  run("r03", "01T12:00:00", { display_name: "eval", group: "exp-44", job_type: "eval", version: 1, values: { mse: 0.3 } }),
  run("r04", "01T13:00:00", { display_name: "ft-lr1e-4", group: "exp-44", job_type: "finetune", version: 1, params: { lr: 0.0001, opt: "adam" }, values: { acc: 0.8 }, loss: [0.3, 1] }),
  run("r05", "01T14:00:00", { display_name: "ft-lr1e-4", group: "exp-44", job_type: "finetune", version: 2, params: { lr: 0.0001, opt: "adam" }, values: { acc: 0.82 }, loss: [0.25, 1], tags: '["prod", "best"]' }),
  run("r06", "02T09:00:00", { display_name: "train", group: "exp-43", job_type: "train", version: 1, params: { lr: 0.01, opt: "sgd" }, values: { acc: 0.6 }, loss: [0.6, 2], status: "failed" }),
  run("r07", "02T10:00:00", { display_name: "eval", group: "exp-43", job_type: "eval", version: 1, values: { mse: 0.45 } }),
  run("r08", "03T09:00:00", { display_name: "s0", group: "seeds", job_type: "train", version: 1, params: { lr: 0.01, seed: 0, opt: "adam" }, values: { acc: 0.66 }, loss: [0.5, 2] }),
  run("r09", "03T09:30:00", { display_name: "s1", group: "seeds", job_type: "train", version: 1, params: { lr: 0.01, seed: 1, opt: "adam" }, values: { acc: 0.64 }, loss: [0.55, 2] }),
  run("r10", "03T10:00:00", { display_name: "s2", group: "seeds", job_type: "train", version: 1, params: { lr: 0.01, seed: 2, opt: "adam" }, values: { acc: 0.69 }, loss: [0.45, 2] }),
  run("r11", "04T09:00:00", { display_name: "baseline", version: 1, params: { lr: 0.1, opt: "sgd" }, values: { acc: 0.5 }, loss: [0.9, 2] }),
  run("r12", "04T10:00:00", { display_name: "baseline", version: 2, params: { lr: 0.1, opt: "sgd" }, values: { acc: 0.52 }, loss: [0.85, 2], tags: '["prod"]' }),
  run("r13", "04T11:00:00", { display_name: "sanity", job_type: "eval", version: 1, values: { mse: 1 } }),
  // An archived re-run: newest of its series, so Latest only drops r10.
  run("r14", "05T09:00:00", { display_name: "s2", group: "seeds", job_type: "train", version: 2, archived: true, values: { acc: 0.7 } }),
  run("r15", "05T10:00:00", { display_name: "Alpha", version: 1, params: { lr: 0.05 }, values: { acc: 0.55 }, status: "running" }),
  run("r16", "05T10:00:00", { display_name: "alpha2", version: 1, params: { lr: 0.5 }, values: { acc: "n/a" } }),
];

// Twelve groups of one run each: only the 10 newest groups are visible by default.
const many: Run[] = Array.from({ length: 12 }, (_, i) =>
  run(`m${String(i).padStart(2, "0")}`, `${String(10 + i).padStart(2, "0")}T00:00:00`, { display_name: `run-${i}`, group: `g${i}`, version: 1, values: { acc: i / 10 } }),
);

const S = (o: Partial<RunSet>): RunSet => ({ ...defaultRunSet("set"), ...o });
const chip = (field: string, op: string, arg: string) => ({ kind: "chip", field, op, arg }) as const;
const and = (...children: unknown[]) => ({ kind: "group", op: "and", children }) as RunSet["filter"];
const or = (...children: unknown[]) => ({ kind: "group", op: "or", children }) as RunSet["filter"];
const expr = (e: string) => ({ kind: "expr", expr: e }) as const;

const cases: Array<{ name: string; pool: "main" | "many"; set: RunSet }> = [
  { name: "default: the 10 newest runs, archived left out", pool: "main", set: S({}) },
  { name: "latest only (an archived newest version still counts)", pool: "main", set: S({ latestOnly: true }) },
  { name: "group = exp-44", pool: "main", set: S({ filter: and(chip("group", "exact", "exp-44")) }) },
  { name: "values.acc > 0.65", pool: "main", set: S({ filter: and(chip("values.acc", "gt", "0.65")) }) },
  { name: "params.lr in 0.1,0.0001", pool: "main", set: S({ filter: and(chip("params.lr", "in", "0.1,0.0001")) }) },
  { name: "tags contains prod", pool: "main", set: S({ filter: and(chip("tags", "contains", "prod")) }) },
  { name: "display_name icontains ALPHA", pool: "main", set: S({ filter: and(chip("display_name", "icontains", "ALPHA")) }) },
  { name: "status exact failed or job_type isnull true", pool: "main", set: S({ filter: or(chip("status", "exact", "failed"), chip("job_type", "isnull", "true")) }) },
  { name: "expression over stats and config", pool: "main", set: S({ filter: and(expr("min(loss) < 0.5 and config.opt == 'adam'")) }) },
  { name: "an invalid expression constrains nothing", pool: "main", set: S({ filter: and(expr("min(loss) <"), chip("group", "exact", "seeds")) }) },
  { name: "a series expression constrains nothing", pool: "main", set: S({ filter: and(expr("loss"), chip("group", "exact", "exp-43")) }) },
  { name: "run.id in [...]", pool: "main", set: runSetOfIds(["r03", "r12", "r14", "r01"]) },
  { name: "grouped by group: every group visible (fewer than 10)", pool: "main", set: S({ groupBy: [{ source: "group" }] }) },
  { name: "grouped by group, one group's eye off, one run's on", pool: "main", set: S({ groupBy: [{ source: "group" }], eyes: { "g:group:exp-44": false, "r:r05": true } }) },
  { name: "grouped by group then job type", pool: "main", set: S({ groupBy: [{ source: "group" }, { source: "job_type" }], latestOnly: true }) },
  { name: "grouped by tag", pool: "main", set: S({ groupBy: [{ source: "tag" }] }) },
  { name: "grouped by param lr, sorted by acc", pool: "main", set: S({ groupBy: [{ source: "param", key: "lr" }], sort: [{ column: "value:acc", direction: "desc" }] }) },
  { name: "grouped by expression", pool: "main", set: S({ groupBy: [{ source: "expr", expr: "config.lr * 10" }], eyes: { "g:config.lr * 10:1": false } }) },
  { name: "run eyes: one off, an old one on", pool: "main", set: S({ eyes: { "r:r16": false, "r:r01": true } }) },
  { name: "sort: acc descending (missing last), then name", pool: "main", set: S({ sort: [{ column: "value:acc", direction: "desc" }, { column: "name", direction: "asc" }], eyes: { "r:r01": true, "r:r02": true, "r:r03": true } }) },
  { name: "sort: param then name, case-insensitive", pool: "main", set: S({ sort: [{ column: "param:opt", direction: "asc" }, { column: "name", direction: "desc" }] }) },
  { name: "sort: status and created ascending", pool: "main", set: S({ sort: [{ column: "status", direction: "asc" }, { column: "created_at", direction: "asc" }] }) },
  { name: "many groups: the 10 newest visible", pool: "many", set: S({ groupBy: [{ source: "group" }] }) },
  { name: "many groups: an old group's eye on", pool: "many", set: S({ groupBy: [{ source: "group" }], eyes: { "g:group:g0": true, "g:group:g11": false } }) },
  { name: "many runs: names sort numerically", pool: "many", set: S({ sort: [{ column: "name", direction: "asc" }], eyes: { "r:m00": true, "r:m01": true } }) },
];

const pools = { main, many };
const doc = {
  description:
    "Run sets (cairn-ui src/lib/run-sets.ts resolveRunSet, cairn cairn/server/run_sets.py resolve_run_set): each case's set resolved over its pool gives `expected`, the visible runs in table order. Generated by scripts/gen-run-set-vectors.ts.",
  pools,
  cases: cases.map((c) => ({ ...c, expected: resolveRunSet(c.set, pools[c.pool]) })),
};
writeFileSync(new URL("../docs/schemas/run-set-vectors.json", import.meta.url), JSON.stringify(doc, null, 1) + "\n");
for (const c of doc.cases) console.log(c.name.padEnd(64), c.expected.join(" "));
