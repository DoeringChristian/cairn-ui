/**
 * The KaTeX flavour of `Markdown` (./markdown.tsx), loaded lazily only for
 * text containing `$$`. Same components and sanitization contract: KaTeX
 * emits its own element tree (no raw-HTML passthrough), with `trust` off.
 */

import { useMemo } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MD_COMPONENTS } from "./markdown";

const MATH: NonNullable<Options["remarkPlugins"]>[number] = [remarkMath, { singleDollarTextMath: false }];
const REHYPE: Options["rehypePlugins"] = [[rehypeKatex, { throwOnError: false, strict: "ignore" }]];

/** `remarkPlugins` and `urlTransform` come from `Markdown`, which adds math on top of them. */
export default function MathMarkdown({
  children,
  remarkPlugins,
  urlTransform,
}: {
  children: string;
  remarkPlugins: NonNullable<Options["remarkPlugins"]>;
  urlTransform: Options["urlTransform"];
}) {
  const remark = useMemo(() => [...remarkPlugins, MATH], [remarkPlugins]);
  return (
    <ReactMarkdown
      remarkPlugins={remark}
      rehypePlugins={REHYPE}
      components={MD_COMPONENTS}
      urlTransform={urlTransform}
    >
      {children}
    </ReactMarkdown>
  );
}
