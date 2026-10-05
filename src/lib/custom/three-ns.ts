/**
 * The app's own three.js as one module, for `cairn:three` in custom viewer
 * frames (three-package.ts reads this chunk's text and what it imports).
 * Imported lazily, only when a viewer uses three: it never joins the main
 * chunk, and its three is the chunk the 3D cards load, so the browser
 * fetches it once.
 */
export * from "three";
/** This chunk's URL: where three-package.ts starts reading. */
export const __cairnChunkUrl: string = import.meta.url;
