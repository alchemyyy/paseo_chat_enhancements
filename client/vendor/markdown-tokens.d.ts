// Declarations of markdown-tokens.js, the bundle scripts/vendor.mjs builds from vendor-src/markdown-tokens.ts.

/** One micromark event: a token entered or exited, with its source offsets */
export interface MarkdownToken {
  enter: boolean;
  /** micromark token type, such as "data", "strongSequence", or "blockQuotePrefix" */
  type: string;
  start: number;
  end: number;
}

/** micromark's events for `source` (CommonMark plus GFM tables, strikethrough, task lists, and autolink literals) */
export declare function tokenizeMarkdown(source: string): MarkdownToken[];

/** The text of a named character reference without its `&` and `;`, or false when the name is unknown */
export declare function decodeNamedCharacterReference(name: string): string | false;
