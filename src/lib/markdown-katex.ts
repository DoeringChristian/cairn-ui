/**
 * The KaTeX half of the markdown renderer, split into its own chunk: loaded
 * (with KaTeX's CSS) only once a text that may contain math renders. See
 * lib/markdown.tsx and lib/markdown/pipeline.ts (`rehypeMath`).
 */

import "katex/dist/katex.min.css";

export { default } from "rehype-katex";
