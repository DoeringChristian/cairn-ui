/**
 * The KaTeX flavour of `Markdown` (./markdown.tsx), loaded lazily only for
 * text containing `$$`. Same components and sanitization contract: KaTeX
 * emits its own element tree (no raw-HTML passthrough), with `trust` off.
 */

import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MD_COMPONENTS } from "./markdown";

const REMARK: Options["remarkPlugins"] = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];
const REHYPE: Options["rehypePlugins"] = [[rehypeKatex, { throwOnError: false, strict: "ignore" }]];

export default function MathMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK}
      rehypePlugins={REHYPE}
      components={MD_COMPONENTS}
    >
      {children}
    </ReactMarkdown>
  );
}
