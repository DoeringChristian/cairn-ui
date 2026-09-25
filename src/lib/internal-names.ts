/**
 * Names under the reserved `_cairn/` prefix are cairn's own attachments
 * (e.g. `_cairn/git.diff`, the dirty-tree diff the SDK uploads). They are
 * surfaced where they mean something (the run overview's Git row) and kept
 * out of every card list: the run page grid, "Add card", the metric index
 * and report/comparison rebuilds.
 */
export const INTERNAL_PREFIX = "_cairn/";

export function isInternalName(name: string): boolean {
  return name.startsWith(INTERNAL_PREFIX);
}

/** The git diff the SDK uploads for a dirty working tree. */
export const GIT_DIFF_ARTIFACT = `${INTERNAL_PREFIX}git.diff`;
