/**
 * Headings of a markdown text: ATX headings (`# Title` … `###### Title`) at
 * the top level, outside fenced code blocks, with GitHub-style anchor slugs.
 *
 * Only top-level ATX headings count: a setext heading (`Title\n===`), or a
 * `#` line inside a list or blockquote, is not a section heading here. The
 * notebook's remark plugin (`remarkHeadingIds`) gives ids by source line, so
 * both sides agree on exactly which headings exist.
 *
 * Slugs follow github-slugger: lower-case, punctuation dropped, spaces to
 * `-`, and a repeat of an earlier slug gets `-1`, `-2`, … . Pass one
 * `Slugger` across several texts (a report's cells) to de-duplicate them
 * together.
 */

export interface MdHeading {
  /** 1–6. */
  level: number;
  /** The heading as plain text (inline markdown stripped). */
  text: string;
  /** 0-based line in the text. */
  line: number;
  /** Unique within its `Slugger`. */
  slug: string;
}

export interface Slugger {
  /** A unique slug for `text`; repeats get `-1`, `-2`, … . */
  slug: (text: string) => string;
}

/** The GitHub slug of one heading text, without de-duplication. */
export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

export function createSlugger(): Slugger {
  const seen = new Map<string, number>();
  return {
    slug(text) {
      const base = githubSlug(text);
      let slug = base;
      while (seen.has(slug)) {
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        slug = `${base}-${n}`;
      }
      seen.set(slug, 0);
      return slug;
    },
  };
}

/**
 * Inline markdown to plain text, roughly as it renders: images and links
 * keep their text, code spans their content, emphasis and strike markers go.
 */
export function inlinePlainText(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*{1,3}|~~)(?=\S)([^*~]*?\S)\1/g, "$2")
    .replace(/(^|[^\p{L}\p{N}])(_{1,3})(?=\S)(.*?\S)\2(?![\p{L}\p{N}])/gu, "$1$3")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .trim();
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/** The top-level ATX headings of `md`, outside fenced code blocks. */
export function extractHeadings(md: string, slugger: Slugger = createSlugger()): MdHeading[] {
  const out: MdHeading[] = [];
  const lines = md.split("\n");
  let fence: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence.char === "`" ? "`" : "~"}{${fence.len},}[ \\t]*$`);
      if (close.test(line)) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { char: open[1]![0]!, len: open[1]!.length };
      continue;
    }
    const m = ATX.exec(line);
    if (!m) continue;
    const text = inlinePlainText(m[2] ?? "");
    if (!text) continue;
    out.push({ level: m[1]!.length, text, line: i, slug: slugger.slug(text) });
  }
  return out;
}
