// The automatic section rule: media go to "Media"; a metric name with a "."
// goes to the section named by its prefix; anything else to "Charts".
// Automatic sections order: Charts, prefix sections A–Z, Media, system last.
// (lib/workspace/layout.ts uses this for panels the layout does not list.)

// R0 fix: this set was missing 8 of the media-like object_types, so e.g.
// a `foo.mesh` metric landed in a "foo" section instead of Media.
const MEDIA_TYPES = new Set([
  "image",
  "audio",
  "video",
  "figure",
  "histogram",
  "tensor",
  "table",
  "pointcloud",
  "mesh",
  "boxes3d",
  "volume",
  "html",
  "markdown",
  "preset",
]);

/** The automatic section of a metric. */
export function autoSectionOf(name: string, objectType: string): string {
  if (MEDIA_TYPES.has(objectType)) return "Media";
  if (name.includes(".")) return name.split(".")[0]!;
  return "Charts";
}

function sectionRank(name: string): number {
  if (name === "Charts") return 0;
  if (name === "Media") return 98;
  if (name === "system") return 99;
  return 1;
}

/** Order of automatic sections: Charts, prefix sections A–Z, Media, system. */
export function compareAutoSections(a: string, b: string): number {
  const d = sectionRank(a) - sectionRank(b);
  return d !== 0 ? d : a.localeCompare(b);
}
