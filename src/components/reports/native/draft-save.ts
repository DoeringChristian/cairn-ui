import type { ReportWorkspace } from "./workspace-api.ts";

export type DraftFiles = Record<string, string>;
export const textFiles = (workspace: ReportWorkspace): DraftFiles =>
  Object.fromEntries(workspace.files.filter(file => file.text !== null).map(file => [file.path, file.text as string]));

export function hasSourceChanges(workspace: ReportWorkspace | null, files: DraftFiles): boolean {
  return !!workspace && workspace.files.some(file => file.text !== null && files[file.path] !== file.text);
}

/** Save through the latest edit, using each acknowledged revision for the next write. */
export async function saveSourceChanges(
  current: () => { workspace: ReportWorkspace | null; files: DraftFiles },
  acknowledge: (workspace: ReportWorkspace) => void,
  write: (id: string, files: DraftFiles, revision: number) => Promise<ReportWorkspace>,
): Promise<ReportWorkspace> {
  for (;;) {
    const {workspace, files} = current();
    if (!workspace) throw new Error("No report workspace");
    if (!hasSourceChanges(workspace, files)) return workspace;
    // A response changes the baseline only. Text typed during the request stays local.
    acknowledge(await write(workspace.id, {...files}, workspace.revision));
  }
}
