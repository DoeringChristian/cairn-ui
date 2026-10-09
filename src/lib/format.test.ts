import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, formatSeconds } from "./format.ts";

test("short runs keep sub-second precision instead of showing 0s", () => {
  assert.equal(formatSeconds(0.4), "0.4s");
  assert.equal(formatSeconds(0.01), "<0.1s");
  assert.equal(formatSeconds(0), "0s");
  assert.equal(formatSeconds(3.24), "3.2s");
  assert.equal(formatSeconds(9.97), "10s");
  assert.equal(formatSeconds(42.9), "42s");
  assert.equal(formatSeconds(125), "2m 5s");
  assert.equal(formatSeconds(7380), "2h 3m");
});

test("formatDuration goes through the same format", () => {
  assert.equal(formatDuration("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.400Z"), "0.4s");
  assert.equal(formatDuration("2026-01-01T00:00:00Z", null, Date.parse("2026-01-01T00:01:01Z")), "1m 1s");
  assert.equal(formatDuration("garbage", null), "—");
});
