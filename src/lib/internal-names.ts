/**
 * Names under the reserved `_cairn/` prefix are cairn's own. They are kept
 * out of every card list: the run page grid, "Add card", the metric index
 * and report/comparison rebuilds.
 */
export const INTERNAL_PREFIX = "_cairn/";

export function isInternalName(name: string): boolean {
  return name.startsWith(INTERNAL_PREFIX);
}
