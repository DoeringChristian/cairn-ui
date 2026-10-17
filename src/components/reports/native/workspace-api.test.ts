import test from "node:test";
import assert from "node:assert/strict";
import { workspaceApi } from "./workspace-api.ts";

test("editing and executing a report copy uses revision guards and separate endpoints", async () => {
  const original = globalThis.fetch;
  const calls: {url: string; method: string; body: unknown}[] = [];
  globalThis.fetch = async (input, options) => {
    calls.push({url: String(input), method: options?.method || "GET", body: options?.body ? JSON.parse(String(options.body)) : undefined});
    return new Response(JSON.stringify({id: "copy", revision: 4, files: []}), {status: 200});
  };
  try {
    await workspaceApi.copy("report-123", "version-123");
    await workspaceApi.save("copy/id", {"report.qmd": "# revised"}, 3);
    await workspaceApi.build("copy/id", 4);
    await workspaceApi.status("build/id");
    assert.deepEqual(calls, [
      {url: "/api/report-workspaces", method: "POST", body: {report_id: "report-123", version_id: "version-123", fork: false}},
      {url: "/api/report-workspaces/copy%2Fid", method: "PUT", body: {files: {"report.qmd": "# revised"}, expected_revision: 3}},
      {url: "/api/report-workspaces/copy%2Fid/build", method: "POST", body: {expected_revision: 4}},
      {url: "/api/report-builds/build%2Fid", method: "GET", body: undefined},
    ]);
  } finally { globalThis.fetch = original; }
});

test("revision conflicts are shown instead of silently overwriting source", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({detail: "Workspace changed; reload before saving"}), {status: 409});
  try {
    await assert.rejects(workspaceApi.save("copy", {"report.qmd": "old edit"}, 1), /Workspace changed/);
  } finally { globalThis.fetch = original; }
});
