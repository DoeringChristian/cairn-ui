/**
 * Pandoc's math and raw-TeX syntax as micromark extensions (the tokenizer
 * layer under remark), with their mdast builders.
 *
 * Text (inside paragraphs, headings, cells, …):
 * - `$…$` inline math, pandoc `tex_math_dollars` rules: the opening `$` is
 *   followed by a non-space; the next `$` closes, and must follow a non-space
 *   and not be followed by a digit, else that opening `$` is a plain dollar —
 *   so "$5 and $10" stays text. `\$` inside is a `$`.
 * - `$$…$$` display math (pandoc renders `$$` as display wherever it is).
 * - `\(…\)` inline and `\[…\]` display math (`tex_math_single_backslash`).
 *   Without a closing `\)`/`\]`, `\(` / `\[` are the usual markdown escapes.
 * All become `inlineMath` nodes; display ones carry `data.display`.
 *
 * Flow (blocks):
 * - `$$` on its own line … `$$` on its own line: a `math` block. Unlike
 *   remark-math, an opening `$$` whose closing line is missing (before a
 *   blank line) is not a block — the paragraph's text math takes it, so
 *   `$$\na = b $$` is display math and never swallows the rest of the text.
 * - `\begin{env}` … `\end{env}` (pandoc `raw_tex`): a `math` block when
 *   KaTeX renders `env` (equation, align, gather, …), else a `rawTex` node
 *   (shown as LaTeX code; passed through verbatim by the LaTeX export).
 * - Lines of `\newcommand`, `\renewcommand`, `\def`, `\DeclareMathOperator`
 *   (pandoc `latex_macros`): a `texMacros` node — the definitions apply to
 *   all math after them in the same text.
 */

import { markdownLineEnding, markdownSpace } from "micromark-util-character";
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from "micromark-util-types";
import type { CompileContext, Extension as FromMarkdownExtension, Token } from "mdast-util-from-markdown";
import type { InlineMath, Math } from "mdast-util-math";
import type { RawTex, TexMacros } from "./mdast-pandoc.ts";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    pandocMathText: "pandocMathText";
    pandocMathMarker: "pandocMathMarker";
    pandocMathData: "pandocMathData";
    pandocMathEol: "pandocMathEol";
    pandocRawTex: "pandocRawTex";
    pandocRawTexValue: "pandocRawTexValue";
    pandocRawTexEol: "pandocRawTexEol";
    pandocMathCheck: "pandocMathCheck";
  }
}

const DOLLAR = 36;
const BACKSLASH = 92;
const PAREN_OPEN = 40;
const PAREN_CLOSE = 41;
const BRACKET_OPEN = 91;
const BRACKET_CLOSE = 93;

const isDigit = (code: Code) => code !== null && code >= 48 && code <= 57;
const isSpaceOrEol = (code: Code) => code === null || markdownSpace(code) || markdownLineEnding(code);

/** Environments KaTeX renders in display mode; any other `\begin{…}` stays raw TeX. */
export const KATEX_ENVIRONMENTS = new Set([
  "equation", "equation*", "align", "align*", "alignat", "alignat*", "aligned", "alignedat",
  "gather", "gather*", "gathered", "split", "CD",
]);

const MACRO_LINE = /^(?:\\newcommand|\\renewcommand|\\providecommand|\\def|\\DeclareMathOperator\*?)(?![A-Za-z])/;

/** Consume one content character into an open data token, splitting line endings into their own tokens. */
function consumeContent(effects: Effects, code: Code, dataType: "pandocMathData" | "pandocRawTexValue", eolType: "pandocMathEol" | "pandocRawTexEol", inData: boolean): boolean {
  if (markdownLineEnding(code)) {
    if (inData) effects.exit(dataType);
    effects.enter(eolType);
    effects.consume(code);
    effects.exit(eolType);
    return false;
  }
  if (!inData) effects.enter(dataType);
  effects.consume(code);
  return true;
}

/* ---------------------------------------------------------------- text */

/** `$…$` and `$$…$$`. */
const dollarMath: Construct = {
  name: "pandocDollarMath",
  tokenize(effects, ok, nok) {
    let inData = false;
    let prev: Code = null;
    function displayCloseTokenize(this: TokenizeContext, eff: Effects, okc: State, nokc: State): State {
      return (code) => {
        eff.enter("pandocMathMarker");
        eff.consume(code);
        return (c2) => {
          if (c2 !== DOLLAR) return nokc(c2);
          eff.consume(c2);
          eff.exit("pandocMathMarker");
          return okc;
        };
      };
    }
    const displayClose: Construct = { tokenize: displayCloseTokenize, partial: true };
    return start;

    function start(code: Code): State | undefined {
      effects.enter("pandocMathText");
      effects.enter("pandocMathMarker");
      effects.consume(code);
      return afterFirst;
    }
    function afterFirst(code: Code): State | undefined {
      if (code === DOLLAR) {
        effects.consume(code);
        effects.exit("pandocMathMarker");
        return displayFirst;
      }
      effects.exit("pandocMathMarker");
      if (isSpaceOrEol(code)) return nok(code);
      return inlineContent(code);
    }

    function inlineContent(code: Code): State | undefined {
      if (code === null) return nok(code);
      // The first `$` ends the math (pandoc): it must follow a non-space and
      // not precede a digit, else there is no math here at all.
      if (code === DOLLAR) {
        if (prev === null || isSpaceOrEol(prev)) return nok(code);
        return effects.check(digitAfterDollar, nok, closeInline)(code);
      }
      if (code === BACKSLASH) {
        inData = consumeContent(effects, code, "pandocMathData", "pandocMathEol", inData);
        prev = code;
        return inlineEscaped;
      }
      inData = consumeContent(effects, code, "pandocMathData", "pandocMathEol", inData);
      prev = code;
      return inlineContent;
    }
    function inlineEscaped(code: Code): State | undefined {
      if (code === null || markdownLineEnding(code)) return inlineContent(code);
      inData = consumeContent(effects, code, "pandocMathData", "pandocMathEol", inData);
      prev = code;
      return inlineContent;
    }
    /** A `$` that closes. */
    function closeInline(code: Code): State | undefined {
      if (inData) effects.exit("pandocMathData");
      effects.enter("pandocMathMarker");
      effects.consume(code);
      effects.exit("pandocMathMarker");
      effects.exit("pandocMathText");
      return ok;
    }

    function displayFirst(code: Code): State | undefined {
      // `$$$` or `$$` followed by nothing is no math.
      if (code === null || code === DOLLAR) return nok(code);
      return displayContent(code);
    }
    function displayContent(code: Code): State | undefined {
      if (code === null) return nok(code);
      if (code === DOLLAR) {
        // End the data before trying the closer: an attempt's own token changes roll back, this flag wouldn't.
        if (inData) effects.exit("pandocMathData");
        inData = false;
        return effects.attempt(displayClose, done, displayDollar)(code);
      }
      if (code === BACKSLASH) {
        inData = consumeContent(effects, code, "pandocMathData", "pandocMathEol", inData);
        return displayEscaped;
      }
      inData = consumeContent(effects, code, "pandocMathData", "pandocMathEol", inData);
      return displayContent;
    }
    function displayEscaped(code: Code): State | undefined {
      if (code === null || markdownLineEnding(code)) return displayContent(code);
      inData = consumeContent(effects, code, "pandocMathData", "pandocMathEol", inData);
      return displayContent;
    }
    /** A lone `$` inside display math is content. */
    function displayDollar(code: Code): State | undefined {
      inData = consumeContent(effects, code, "pandocMathData", "pandocMathEol", inData);
      return displayContent;
    }
    function done(code: Code): State | undefined {
      effects.exit("pandocMathText");
      return ok(code);
    }
  },
};

/** Succeeds when the `$` here is followed by a digit (so it doesn't close inline math). */
const digitAfterDollar: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return (code) => {
      effects.enter("pandocMathCheck");
      effects.consume(code);
      return (next) => {
        effects.exit("pandocMathCheck");
        return isDigit(next) ? ok(next) : nok(next);
      };
    };
  },
};

/** `\(…\)` and `\[…\]`. */
const backslashMath: Construct = {
  name: "pandocBackslashMath",
  tokenize(effects, ok, nok) {
    let closer = 0;
    let inData = false;
    let empty = true;
    const closeTokenizer: Construct = {
      partial: true,
      tokenize(eff, okc, nokc) {
        return (code) => {
          eff.enter("pandocMathMarker");
          eff.consume(code);
          return (c2) => {
            if (c2 !== closer) return nokc(c2);
            eff.consume(c2);
            eff.exit("pandocMathMarker");
            return okc;
          };
        };
      },
    };
    return start;

    function start(code: Code): State | undefined {
      effects.enter("pandocMathText");
      effects.enter("pandocMathMarker");
      effects.consume(code);
      return open;
    }
    function open(code: Code): State | undefined {
      if (code !== PAREN_OPEN && code !== BRACKET_OPEN) return nok(code);
      closer = code === PAREN_OPEN ? PAREN_CLOSE : BRACKET_CLOSE;
      effects.consume(code);
      effects.exit("pandocMathMarker");
      return content;
    }
    function content(code: Code): State | undefined {
      if (code === null) return nok(code);
      if (code === BACKSLASH) {
        if (inData) effects.exit("pandocMathData");
        inData = false;
        return effects.attempt(closeTokenizer, done, escaped)(code);
      }
      inData = consumeContent(effects, code, "pandocMathData", "pandocMathEol", inData);
      if (!markdownLineEnding(code) && !markdownSpace(code)) empty = false;
      return content;
    }
    function escaped(code: Code): State | undefined {
      // Not the closer: the backslash and the character after it are content.
      inData = consumeContent(effects, code, "pandocMathData", "pandocMathEol", inData);
      empty = false;
      return (next: Code) => {
        if (next === null || markdownLineEnding(next)) return content(next);
        inData = consumeContent(effects, next, "pandocMathData", "pandocMathEol", inData);
        return content;
      };
    }
    function done(code: Code): State | undefined {
      if (empty) return nok(code);
      effects.exit("pandocMathText");
      return ok(code);
    }
  },
};

/* ---------------------------------------------------------------- flow */

/** Wraps remark-math's `$$` fence so it only applies when its closing line exists. */
function guardedMathFlow(mathFlow: Construct): Construct {
  return {
    ...mathFlow,
    tokenize(effects, ok, nok) {
      const inner = mathFlow.tokenize.call(this, effects, ok, nok);
      return (code) => effects.check(closingFenceAhead, inner, nok)(code);
    },
  };
}

/** Is there a closing `$$` line (the last line of the text counts) before a blank line or the end? */
const closingFenceAhead: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    let line = "";
    let first = true;
    return function scan(code: Code): State | undefined {
      if (code === null || markdownLineEnding(code)) {
        if (!first) {
          if (/^\s*\$\$+\s*$/.test(line)) return ok(code);
          if (/^\s*$/.test(line) || code === null) return nok(code);
        } else if (code === null) return nok(code);
        first = false;
        line = "";
        effects.enter("pandocMathCheck");
        effects.consume(code);
        effects.exit("pandocMathCheck");
        return scan;
      }
      line += code < 0 ? " " : String.fromCharCode(code);
      effects.enter("pandocMathCheck");
      effects.consume(code);
      effects.exit("pandocMathCheck");
      return scan;
    };
  },
};

const nonLazyContinuation: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    const self = this;
    return (code) => {
      if (code === null) return ok(code);
      effects.enter("pandocRawTexEol");
      effects.consume(code);
      effects.exit("pandocRawTexEol");
      return (next: Code) => (self.parser.lazy[self.now().line] ? nok(next) : ok(next));
    };
  },
};

/** `\begin{env}…\end{env}` and macro-definition lines at the start of a block. */
const rawTex: Construct = {
  name: "pandocRawTex",
  concrete: true,
  tokenize(effects, ok, nok) {
    const self = this;
    let line = "";
    let env: string | null = null;
    let depth = 0;
    let braces = 0;
    return start;

    function start(code: Code): State | undefined {
      if (self.interrupt) return nok(code);
      effects.enter("pandocRawTex");
      effects.enter("pandocRawTexValue");
      return firstLine(code);
    }
    function firstLine(code: Code): State | undefined {
      if (code === null || markdownLineEnding(code)) {
        const begin = /^\\begin\{([A-Za-z*]+)\}/.exec(line);
        if (begin) {
          env = begin[1]!;
          return countEnv(line) ? lineDone(code) : closeAll(code);
        }
        if (MACRO_LINE.test(line)) {
          braces = braceDelta(line);
          return braces > 0 ? lineDone(code) : macroNext(code);
        }
        return nok(code);
      }
      // Decide early, so ordinary `\` lines fail fast.
      if (line.length === 0 && code !== BACKSLASH) return nok(code);
      line += code < 0 ? " " : String.fromCharCode(code);
      if (line.length === 2 && !/^\\[bnrdpD]/.test(line)) return nok(code);
      effects.consume(code);
      return firstLine;
    }
    /** For `\begin`: tracks nesting; true while the environment is still open after this line. */
    function countEnv(text: string): boolean {
      const re = new RegExp(`\\\\(begin|end)\\{${env!.replace(/\*/g, "\\*")}\\}`, "g");
      for (const m of text.matchAll(re)) depth += m[1] === "begin" ? 1 : -1;
      return depth > 0;
    }
    function braceDelta(text: string): number {
      let d = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === "{") d++;
        else if (text[i] === "}") d--;
      }
      return d;
    }
    function lineDone(code: Code): State | undefined {
      effects.exit("pandocRawTexValue");
      if (code === null) return env ? nok(code) : closeAll(code);
      return effects.attempt(nonLazyContinuation, nextLine, env ? nok : closeAll)(code);
    }
    /** After a complete macro line: continue when the next line is another one. */
    function macroNext(code: Code): State | undefined {
      effects.exit("pandocRawTexValue");
      if (code === null) return closeAll(code);
      return effects.check(macroLineAhead, (c: Code) => effects.attempt(nonLazyContinuation, nextLine, closeAll)(c), closeAll)(code);
    }
    function nextLine(code: Code): State | undefined {
      line = "";
      effects.enter("pandocRawTexValue");
      return contentLine(code);
    }
    function contentLine(code: Code): State | undefined {
      if (code === null || markdownLineEnding(code)) {
        if (env) {
          if (!countEnv(line)) return closeAll(code);
          if (code === null) return nok(code);
          return lineDone(code);
        }
        braces += braceDelta(line);
        if (braces > 0) {
          if (code === null) return nok(code);
          return lineDone(code);
        }
        return macroNext(code);
      }
      line += code < 0 ? " " : String.fromCharCode(code);
      effects.consume(code);
      return contentLine;
    }
    function closeAll(code: Code): State | undefined {
      if (env) effects.exit("pandocRawTexValue");
      effects.exit("pandocRawTex");
      return ok(code);
    }
  },
};

/** Is the next line another macro definition? */
const macroLineAhead: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    let line = "";
    return (code) => {
      effects.enter("pandocMathCheck");
      effects.consume(code);
      return function scan(c: Code): State | undefined {
        if (c === null || markdownLineEnding(c) || line.length > 24) {
          effects.exit("pandocMathCheck");
          return MACRO_LINE.test(line) ? ok(c) : nok(c);
        }
        line += c < 0 ? " " : String.fromCharCode(c);
        effects.consume(c);
        return scan;
      };
    };
  },
};

/** The micromark extension: text math, the guarded `$$` fence, raw TeX blocks. */
export function pandocMathSyntax(mathFlow: Construct): Extension {
  return {
    text: { [DOLLAR]: dollarMath, [BACKSLASH]: backslashMath },
    flow: { [DOLLAR]: guardedMathFlow(mathFlow), [BACKSLASH]: rawTex },
  };
}

/* ------------------------------------------------------------- mdast */

function stripMarkers(raw: string): { value: string; display: boolean } {
  if (raw.startsWith("$$")) return { value: raw.slice(2, -2), display: true };
  if (raw.startsWith("$")) return { value: raw.slice(1, -1), display: false };
  return { value: raw.slice(2, -2), display: raw[1] === "[" };
}

/** `inlineMath` for text math; display math keeps the class rehype-katex renders in display mode. */
export function inlineMathNode(value: string, display: boolean): InlineMath {
  return {
    type: "inlineMath",
    value,
    data: {
      ...(display ? { display: true } : {}),
      hName: "code",
      hProperties: { className: ["language-math", display ? "math-display" : "math-inline"] },
      hChildren: [{ type: "text", value }],
    },
  };
}

/** A display `math` block, built the way remark-math builds its own. */
export function mathBlockNode(value: string): Math {
  return {
    type: "math",
    value,
    data: {
      hName: "pre",
      hChildren: [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-math", "math-display"] },
          children: [{ type: "text", value }],
        },
      ],
    },
  };
}

/** KaTeX has no `\DeclareMathOperator`; the same definition as a `\newcommand`. */
export function katexMacroSource(src: string): string {
  return src.replace(/\\DeclareMathOperator(\*?)\s*\{?\s*(\\[A-Za-z]+)\s*\}?\s*\{/g, (_m, star: string, name: string) => `\\newcommand{${name}}{\\operatorname${star}{`)
    .replace(/(\\operatorname\*?\{[^{}]*\})/g, "$1}");
}

export function pandocMathFromMarkdown(): FromMarkdownExtension {
  return {
    enter: {
      pandocMathText(this: CompileContext, token: Token) {
        this.enter(inlineMathNode("", false), token);
      },
      pandocRawTex(this: CompileContext, token: Token) {
        this.enter({ type: "rawTex", value: "" } as RawTex, token);
        this.data.pandocRawTexLines = [];
      },
    },
    exit: {
      pandocMathText(this: CompileContext, token: Token) {
        const node = this.stack[this.stack.length - 1] as InlineMath;
        const { value, display } = stripMarkers(this.sliceSerialize(token));
        Object.assign(node, inlineMathNode(value, display));
        this.exit(token);
      },
      pandocRawTexValue(this: CompileContext, token: Token) {
        this.data.pandocRawTexLines!.push(this.sliceSerialize(token));
      },
      pandocRawTex(this: CompileContext, token: Token) {
        const node = this.stack[this.stack.length - 1] as unknown as RawTex | TexMacros | Math;
        const value = this.data.pandocRawTexLines!.join("\n");
        this.data.pandocRawTexLines = undefined;
        const env = /^\\begin\{([A-Za-z*]+)\}/.exec(value)?.[1];
        if (env === undefined) {
          Object.assign(node, {
            type: "texMacros",
            value,
            data: {
              hName: "div",
              hProperties: { hidden: true, className: ["md-tex-macros"] },
              hChildren: [{ type: "element", tagName: "code", properties: { className: ["language-math", "math-inline"] }, children: [{ type: "text", value: katexMacroSource(value) }] }],
            },
          });
        } else if (KATEX_ENVIRONMENTS.has(env)) {
          Object.assign(node, mathBlockNode(value), { data: { ...mathBlockNode(value).data, rawTex: true } });
        } else {
          Object.assign(node, {
            type: "rawTex",
            value,
            data: {
              hName: "pre",
              hChildren: [{ type: "element", tagName: "code", properties: { className: ["language-latex"] }, children: [{ type: "text", value }] }],
            },
          });
        }
        this.exit(token);
      },
    },
  };
}

declare module "mdast-util-from-markdown" {
  interface CompileData {
    pandocRawTexLines?: string[];
  }
}
