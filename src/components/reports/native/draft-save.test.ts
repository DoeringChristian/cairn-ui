import test from "node:test";
import assert from "node:assert/strict";
import { hasSourceChanges, saveSourceChanges, textFiles } from "./draft-save.ts";
import type { ReportWorkspace } from "./workspace-api.ts";

const draft = (text: string, revision = 1): ReportWorkspace => ({
  id: "workspace", project_id: "project", slug: "study", entry: "report.qmd", revision,
  files: [{path: "report.qmd", text}, {path: "image.png", text: null}],
});

test("saving drains edits made during an in-flight save without replacing the editor text", async () => {
  let workspace = draft("original");
  let files = {"report.qmd": "first edit"};
  const calls: {files: Record<string, string>; revision: number}[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  const saving = saveSourceChanges(() => ({workspace, files}), value => {workspace = value;}, async (_id, sent, revision) => {
    calls.push({files: sent, revision});
    if (calls.length === 1) await pending;
    return draft(sent["report.qmd"], revision + 1);
  });
  files = {"report.qmd": "typed while saving"};
  release();
  const saved = await saving;
  assert.deepEqual(calls, [
    {files: {"report.qmd": "first edit"}, revision: 1},
    {files: {"report.qmd": "typed while saving"}, revision: 2},
  ]);
  assert.equal(saved.revision, 3);
  assert.equal(files["report.qmd"], "typed while saving");
  assert.equal(hasSourceChanges(saved, files), false);
});

test("a failed save retains unsaved text and the acknowledged revision for recovery", async () => {
  let workspace = draft("original", 5);
  const files = {"report.qmd": "keep this edit"};
  await assert.rejects(saveSourceChanges(() => ({workspace, files}), value => {workspace = value;}, async () => {
    throw new Error("Workspace changed; reload before saving");
  }), /Workspace changed/);
  assert.equal(workspace.revision, 5);
  assert.equal(files["report.qmd"], "keep this edit");
  assert.equal(hasSourceChanges(workspace, files), true);
});

test("an unchanged draft needs no save and binary resources do not mark it dirty", async () => {
  const workspace = draft("saved");
  const files = textFiles(workspace);
  assert.deepEqual(files, {"report.qmd": "saved"});
  const result = await saveSourceChanges(() => ({workspace, files}), () => assert.fail("No new baseline"), async () => {
    assert.fail("No redundant write");
  });
  assert.equal(result, workspace);
});
