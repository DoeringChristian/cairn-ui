import { test } from "node:test";
import assert from "node:assert/strict";
import type { Alert } from "../api/types.ts";
import { newestCreatedAt, unseenCount } from "./alerts.ts";

const mk = (created_at: string): Alert => ({
  id: created_at, run_id: "r", run_name: null, level: "info", title: "t", text: "",
  created_at, delivered_at: null,
});
const alerts = [mk("2024-01-03T00:00:00+00:00"), mk("2024-01-01T00:00:00+00:00"), mk("2024-01-02T00:00:00+00:00")];

test("never opened: every alert is unseen", () => {
  assert.equal(unseenCount(alerts, null), 3);
});

test("only alerts after the last-seen time count", () => {
  assert.equal(unseenCount(alerts, "2024-01-01T12:00:00Z"), 2);
  assert.equal(unseenCount(alerts, newestCreatedAt(alerts)), 0);
});

test("newestCreatedAt compares times, not strings", () => {
  assert.equal(newestCreatedAt(alerts), "2024-01-03T00:00:00+00:00");
  assert.equal(newestCreatedAt([mk("2024-01-01T10:00:00+05:00"), mk("2024-01-01T06:00:00+00:00")]),
    "2024-01-01T06:00:00+00:00");
  assert.equal(newestCreatedAt([]), null);
});
