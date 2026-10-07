import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunProgress } from "../api/types.ts";
import {
  formatCounts,
  formatEta,
  formatEtaShort,
  formatPct,
  progressDisplay,
  runningText,
} from "./run-progress.ts";

const p = (over: Partial<RunProgress> = {}): RunProgress => ({
  fraction: 0.58, current: 5800, total: 10000, unit: "step", eta_seconds: 540, ...over,
});

test("no progress: nothing shown, whatever the status", () => {
  assert.equal(progressDisplay("running", null), null);
  assert.equal(progressDisplay("completed", undefined), null);
});

test("running shows the bar state with the ETA; every other status the percentage only", () => {
  assert.deepEqual(progressDisplay("running", p()), { kind: "running", pct: "58%", eta: 540 });
  for (const s of ["completed", "failed", "killed", "stopped", "crashed"] as const) {
    assert.deepEqual(progressDisplay(s, p({ fraction: 0.62 })), { kind: "ended", pct: "62%" });
  }
});

test("percentage rounds to the nearest integer and is clamped", () => {
  assert.equal(formatPct(0.5849), "58%");
  assert.equal(formatPct(0.585), "59%");
  assert.equal(formatPct(0.9999), "100%");
  assert.equal(formatPct(1.2), "100%");
  assert.equal(formatPct(-0.1), "0%");
});

test("ETA: seconds under a minute, minutes under an hour, else hours", () => {
  assert.equal(formatEta(null), "—");
  assert.equal(formatEta(40.4), "~40 s left");
  assert.equal(formatEta(0), "~0 s left");
  assert.equal(formatEta(540), "~9 min left");
  assert.equal(formatEta(569), "~9 min left");
  assert.equal(formatEta(571), "~10 min left");
  assert.equal(formatEta(3570), "~1 h left");
  assert.equal(formatEta(7200), "~2 h left");
  assert.equal(formatEtaShort(540), "~9m");
  assert.equal(formatEtaShort(7300), "~2h");
  assert.equal(formatEtaShort(40), "~40s");
  assert.equal(formatEtaShort(null), "—");
});

test("running text", () => {
  assert.equal(runningText("58%", 540), "58% · ~9 min left");
  assert.equal(runningText("58%", null), "58% · —");
  assert.equal(runningText("58%", 540, true), "58% · ~9m");
});

test("counts: 'step' only for step progress", () => {
  assert.equal(formatCounts(p()), "step 5,800 / 10,000");
  assert.equal(formatCounts(p({ unit: "progress", current: 3, total: 10 })), "3 / 10");
});
