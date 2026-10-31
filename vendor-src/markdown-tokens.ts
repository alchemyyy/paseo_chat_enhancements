// Entry of client/vendor/markdown-tokens.js (scripts/vendor.mjs bundles it with micromark, since an
// installed plugin has no node_modules); its declarations are the hand-written markdown-tokens.d.ts.
// micromark tokenizes CommonMark plus the GFM syntax Paseo's renderer (md4c, "github" flavor) knows:
// tables, strikethrough, task list items, and autolink literals. Footnotes are left out, as md4c
// has none.
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { parse, postprocess, preprocess } from "micromark";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

export interface MarkdownToken {
  enter: boolean;
  type: string;
  start: number;
  end: number;
}

const extensions = [gfmTable(), gfmStrikethrough(), gfmAutolinkLiteral(), gfmTaskListItem()];

/** micromark's events for `source`, in document order */
export function tokenizeMarkdown(source: string): MarkdownToken[] {
  const events = postprocess(parse({ extensions }).document().write(preprocess()(source, undefined, true)));
  return events.map(([kind, token]) => ({
    enter: kind === "enter",
    type: token.type,
    start: token.start.offset,
    end: token.end.offset,
  }));
}

export { decodeNamedCharacterReference };
