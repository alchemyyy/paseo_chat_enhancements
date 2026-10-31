// Maps rendered chat Markdown back to the source that produced it. Paseo renders Markdown with md4c,
// whose syntax tree has no source positions, so the source is tokenized again with micromark (the
// same CommonMark + GFM syntax): every rendered character is tied to the source range it came from,
// and every construct to its markup, so a selection of rendered text can be copied as Markdown.

import { decodeNamedCharacterReference, tokenizeMarkdown } from "./vendor/markdown-tokens.js";

/** Stands for an image, which renders as an element with no text */
export const OBJECT_CHARACTER = "\uFFFC";

export interface MarkdownSourceMap {
  source: string;
  /** The text a renderer shows: line breaks as `\n`, images as OBJECT_CHARACTER */
  text: string;
  /** Source range of each character of `text` */
  from: number[];
  to: number[];
  constructs: Construct[];
  cells: TableCell[];
}

/** A table cell with its pipes (`start`..`end`) and the source range of its rendered text (`first`..`last`) */
interface TableCell {
  table: number;
  start: number;
  end: number;
  first: number;
  last: number;
}

interface Construct {
  start: number;
  end: number;
  /**
   * Inline markup (emphasis, code spans, links) goes when the construct is partly outside the copy.
   * Block markup (quote markers, list indents, heading and fence markup) goes when the block starts
   * before the copy: a block that starts inside it needs no closing markup.
   */
  inline: boolean;
  /** Ranges of markup, flattened: start, end, start, end, ... */
  markup: number[];
}

/** Tokens whose content renders as no text; escapes, references, and images render as one unit */
const UNRENDERED: Record<string, true> = {
  characterEscape: true,
  characterReference: true,
  codeFencedFence: true,
  definition: true,
  htmlFlow: true,
  htmlText: true,
  image: true,
  reference: true,
  resource: true,
  tableDelimiterRow: true,
  taskListCheck: true,
};
/** Tokens rendered exactly as written */
const LITERAL: Record<string, true> = {
  data: true,
  codeTextData: true,
  codeFlowValue: true,
  autolinkProtocol: true,
  autolinkEmail: true,
  literalAutolinkHttp: true,
  literalAutolinkWww: true,
  literalAutolinkEmail: true,
};
const INLINE_CONSTRUCTS: Record<string, true> = {
  emphasis: true,
  strong: true,
  strikethrough: true,
  codeText: true,
  link: true,
  autolink: true,
};
const INLINE_MARKUP: Record<string, true> = {
  emphasisSequence: true,
  strongSequence: true,
  strikethroughSequence: true,
  codeTextSequence: true,
  codeTextPadding: true,
  autolinkMarker: true,
};
/** How a line ending renders inside each token; anywhere else it separates blocks and renders as nothing */
const LINE_BREAKS: Record<string, string> = {
  codeText: " ",
  codeFenced: "\n",
  codeIndented: "\n",
  paragraph: "\n",
  setextHeadingText: "\n",
};

function decodeReference(reference: string): string {
  const body = reference.slice(1, -1);
  if (body[0] !== "#") return decodeNamedCharacterReference(body) || reference;
  const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
  const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return valid ? String.fromCodePoint(code) : "\uFFFD";
}

/** Rendered text of `source`, each character tied to its source range, and the markup of each construct */
export function mapMarkdownSource(source: string): MarkdownSourceMap {
  const text: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  const constructs: Construct[] = [];
  const cells: TableCell[] = [];
  let tables = 0;
  let cell: TableCell | null = null;
  const emit = (characters: string, start: number, end: number, literal: boolean) => {
    for (let index = 0; index < characters.length; index++) {
      text.push(characters[index]);
      from.push(literal ? start + index : start);
      to.push(literal ? start + index + 1 : end);
    }
    if (cell && characters.length > 0) {
      if (cell.first < 0) cell.first = start;
      cell.last = literal ? start + characters.length : end;
    }
  };
  const open = (start: number, end: number, inline: boolean): Construct => {
    const construct: Construct = { start, end, inline, markup: [] };
    constructs.push(construct);
    return construct;
  };

  /** Types of the open tokens, outermost first */
  const stack: string[] = [];
  /** Stack index of the token whose content renders as nothing, or -1 */
  let unrenderedAt = -1;
  /** Open inline constructs, innermost last, with the stack index that opened them */
  const inline: { construct: Construct; type: string; at: number; labelMarkers: number }[] = [];
  /** Open block quotes and lists, outermost first; continuation lines carry their markers in this order */
  const quotes: { construct: Construct; at: number }[] = [];
  const lists: { item: Construct | null; end: number; at: number }[] = [];
  let quotesOnLine = 0;
  let indentsOnLine = 0;
  const fences: { construct: Construct; at: number; fences: number; lineEndings: number; lastLineEnding: number }[] = [];
  let indented: { construct: Construct; at: number } | null = null;
  let heading: { construct: Construct; at: number; sequences: number[]; textEnd: number } | null = null;

  for (const token of tokenizeMarkdown(source)) {
    const { type, start, end } = token;
    if (!token.enter) {
      const at = stack.length - 1;
      stack.pop();
      if (at === unrenderedAt) unrenderedAt = -1;
      if (cell && (type === "tableHeader" || type === "tableData")) {
        if (cell.first >= 0) cells.push(cell);
        cell = null;
      }
      if (inline.at(-1)?.at === at) inline.pop();
      if (quotes.at(-1)?.at === at) quotes.pop();
      if (fences.at(-1)?.at === at) fences.pop();
      if (indented?.at === at) indented = null;
      if (lists.at(-1)?.at === at) lists.pop();
      if (heading?.at === at) {
        const { construct, sequences, textEnd } = heading;
        // An ATX heading's closing sequence, with the space before it
        if (type === "atxHeading" && sequences.length >= 4) {
          construct.markup.push(textEnd >= 0 ? textEnd : sequences[1], sequences.at(-1)!);
        }
        heading = null;
      }
      if (heading && (type === "atxHeadingText" || type === "setextHeadingText")) {
        heading.textEnd = end;
        // A setext heading's underline, with the line ending and markers before it
        if (type === "setextHeadingText") heading.construct.markup.push(end, heading.construct.end);
      }
      continue;
    }

    const parent = stack.at(-1);
    const rendered = unrenderedAt === -1;
    stack.push(type);
    const at = stack.length - 1;

    // Container markers are tracked even inside unrendered content, which can span lines
    switch (type) {
      case "lineEnding":
      case "lineEndingBlank":
        quotesOnLine = 0;
        indentsOnLine = 0;
        break;
      case "blockQuote":
        quotes.push({ construct: open(start, end, false), at });
        break;
      case "blockQuotePrefix":
        quotes[quotesOnLine++]?.construct.markup.push(start, end);
        break;
      case "listOrdered":
      case "listUnordered":
        lists.push({ item: null, end, at });
        break;
      case "listItemPrefix": {
        const list = lists.at(-1);
        if (!list) break;
        if (list.item) list.item.end = start;
        list.item = open(start, list.end, false);
        break;
      }
      case "listItemIndent":
        lists[indentsOnLine++]?.item?.markup.push(start, end);
        break;
    }

    if (rendered && UNRENDERED[type]) {
      unrenderedAt = at;
      if (type === "characterEscape") emit(source[start + 1], start, end, false);
      else if (type === "characterReference") emit(decodeReference(source.slice(start, end)), start, end, false);
      else if (type === "image") emit(OBJECT_CHARACTER, start, end, false);
    }

    switch (type) {
      case "codeFenced":
        fences.push({ construct: open(start, end, false), at, fences: 0, lineEndings: 0, lastLineEnding: -1 });
        break;
      case "codeFencedFence": {
        const fence = fences.at(-1);
        // The closing fence, with the line ending and markers before it
        if (fence && ++fence.fences === 2 && fence.lastLineEnding >= 0) {
          fence.construct.markup.push(fence.lastLineEnding, end);
        }
        break;
      }
      case "codeIndented":
        indented = { construct: open(start, end, false), at };
        break;
      case "linePrefix":
        if (parent === "codeIndented") indented?.construct.markup.push(start, end);
        break;
      case "atxHeading":
      case "setextHeading":
        heading = { construct: open(start, end, false), at, sequences: [], textEnd: -1 };
        break;
      case "atxHeadingSequence":
        heading?.sequences.push(start, end);
        break;
      case "table":
        tables++;
        break;
      case "tableHeader":
      case "tableData":
        cell = { table: tables, start, end, first: -1, last: -1 };
        break;
    }

    if (!rendered) continue;
    if (LITERAL[type]) {
      emit(source.slice(start, end), start, end, true);
    } else if (type === "lineEnding") {
      // micromark ends a line ending inside a container after the next line's markers
      const length = source.startsWith("\r\n", start) ? 2 : 1;
      const fence = parent === "codeFenced" ? fences.at(-1) : undefined;
      if (fence) fence.lastLineEnding = start;
      // The line ending after the opening fence is not code
      if (fence && fence.lineEndings++ === 0) continue;
      for (let index = at - 1; index >= 0; index--) {
        const lineBreak = LINE_BREAKS[stack[index]];
        if (lineBreak) {
          emit(lineBreak, start, start + length, false);
          break;
        }
      }
    } else if (INLINE_CONSTRUCTS[type]) {
      inline.push({ construct: open(start, end, true), type, at, labelMarkers: 0 });
    } else if (INLINE_MARKUP[type]) {
      inline.at(-1)?.construct.markup.push(start, end);
    } else if (type === "labelMarker") {
      const link = inline.at(-1);
      if (link?.type === "link") {
        // `[`, then everything from `]` to the end: the destination, title, or reference
        link.construct.markup.push(start, ++link.labelMarkers === 1 ? end : link.construct.end);
      }
    }
  }
  return { source, text: text.join(""), from, to, constructs, cells };
}

/** Characters that must agree for the alignment to pick up again after a difference */
const RESYNC_RUN = 8;
/** How far ahead each side is searched for that run */
const RESYNC_WINDOW = 2048;
/** Skip positions tried on each side before a difference counts as a substitution */
const RESYNC_PROBES = 32;
const MAX_SUBSTITUTIONS = 256;

/** Where `run` occurs in `window` at or after `minimum`; `windowEnds` when the window reaches its text's end */
function findRun(window: string, windowEnds: boolean, run: string, minimum: number): number {
  if (run.length === RESYNC_RUN) return window.indexOf(run, minimum);
  // A run is short only at the end of its text, and anchors only when the other text ends with it
  const index = window.length - run.length;
  return windowEnds && index >= minimum && window.endsWith(run) ? index : -1;
}

/** The fewest characters to skip in `rendered` and `expected` so both continue alike */
function resynchronize(rendered: string, i: number, expected: string, j: number): [number, number] | null {
  const renderedWindow = rendered.slice(i, i + RESYNC_WINDOW);
  const expectedWindow = expected.slice(j, j + RESYNC_WINDOW);
  const renderedEnds = i + renderedWindow.length === rendered.length;
  const expectedEnds = j + expectedWindow.length === expected.length;
  let best: [number, number] | null = null;
  for (let skip = 0; skip < RESYNC_PROBES && skip < renderedWindow.length; skip++) {
    if (best && skip >= best[0] + best[1]) break;
    const run = renderedWindow.slice(skip, skip + RESYNC_RUN);
    const other = findRun(expectedWindow, expectedEnds, run, skip === 0 ? 1 : 0);
    if (other >= 0 && (!best || skip + other < best[0] + best[1])) best = [skip, other];
  }
  for (let skip = 0; skip < RESYNC_PROBES && skip < expectedWindow.length; skip++) {
    if (best && skip >= best[0] + best[1]) break;
    const run = expectedWindow.slice(skip, skip + RESYNC_RUN);
    const other = findRun(renderedWindow, renderedEnds, run, skip === 0 ? 1 : 0);
    if (other >= 0 && (!best || skip + other < best[0] + best[1])) best = [other, skip];
  }
  return best;
}

/**
 * The character of `expected` each character of `rendered` matches, or -1. The texts differ where
 * the renderer adds or drops text the source map does not model; null when they hardly agree.
 */
export function alignText(rendered: string, expected: string): Int32Array | null {
  const matches = new Int32Array(rendered.length).fill(-1);
  let i = 0;
  let j = 0;
  let matched = 0;
  let substitutions = 0;
  while (i < rendered.length && j < expected.length) {
    if (rendered.charCodeAt(i) === expected.charCodeAt(j)) {
      matches[i++] = j++;
      matched++;
      continue;
    }
    const skip = resynchronize(rendered, i, expected, j);
    if (skip) {
      i += skip[0];
      j += skip[1];
    } else if (++substitutions > MAX_SUBSTITUTIONS) {
      break;
    } else {
      i++;
      j++;
    }
  }
  return matched * 2 >= rendered.length ? matches : null;
}

/** Source range from the first to the last of the rendered characters `start`..`end` that came from the source */
export function sourceRangeOf(
  map: MarkdownSourceMap,
  matches: Int32Array,
  start: number,
  end: number,
): [number, number] | null {
  let first = start;
  while (first < end && matches[first] < 0) first++;
  let last = end - 1;
  while (last >= first && matches[last] < 0) last--;
  if (first > last) return null;
  return [map.from[matches[first]], map.to[matches[last]]];
}

/**
 * The source from `start` to `end`, without the markup of constructs the range cuts: no
 * delimiters, link targets, or block markers are left over from text outside the range.
 */
export function sliceMarkdown(map: MarkdownSourceMap, start: number, end: number): string {
  // Spanning several cells of a table, whole cells at the edges bring their pipes so rows stay rows:
  // without its leading pipe, a row starting `# |` would read as a heading
  const cells = map.cells.filter((cell) => cell.first < end && cell.last > start);
  const firstCell = cells[0];
  if (firstCell && start <= firstCell.first && cells[1]?.table === firstCell.table) {
    start = Math.min(start, firstCell.start);
  }
  const lastCell = cells.at(-1);
  if (lastCell && end >= lastCell.last && cells.at(-2)?.table === lastCell.table) {
    // A cell ends before the next cell's pipe; the row's last cell ends with its own
    end = Math.max(end, map.source[lastCell.end] === "|" ? lastCell.end + 1 : lastCell.end);
  }
  const removed: [number, number][] = [];
  for (const construct of map.constructs) {
    if (construct.markup.length === 0 || construct.end <= start || construct.start >= end) continue;
    const cut = construct.inline ? construct.start < start || construct.end > end : construct.start < start;
    if (!cut) continue;
    for (let index = 0; index < construct.markup.length; index += 2) {
      const from = Math.max(construct.markup[index], start);
      const to = Math.min(construct.markup[index + 1], end);
      if (from < to) removed.push([from, to]);
    }
  }
  removed.sort((left, right) => left[0] - right[0]);
  let result = "";
  let position = start;
  for (const [from, to] of removed) {
    if (from > position) result += map.source.slice(position, from);
    position = Math.max(position, to);
  }
  return result + map.source.slice(position, end);
}

const LEADING_LINE_BREAKS = /^(?:[ \t]*\r?\n)+/;
const TRAILING_LINE_BREAKS = /(?:\r?\n[ \t]*)+$/;

/** Copied pieces (Markdown, or plain text between messages) as one text, a blank line between pieces */
export function joinCopiedParts(parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(LEADING_LINE_BREAKS, "").replace(TRAILING_LINE_BREAKS, ""))
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}
