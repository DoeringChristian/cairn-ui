import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "./fetch-limit.ts";

test("never more than max tasks in flight, all run, in order, failures release the slot", async () => {
  const limit = createLimiter(3);
  let inFlight = 0;
  let peak = 0;
  const started: number[] = [];
  const task = (i: number) => async () => {
    started.push(i);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    if (i === 4) throw new Error("boom");
    return i;
  };
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => limit(task(i))));
  assert.equal(peak, 3);
  assert.deepEqual(started, Array.from({ length: 20 }, (_, i) => i));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 19);
  assert.equal(results[4]!.status, "rejected");
});
