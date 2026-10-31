import assert from "node:assert/strict";
import { test } from "node:test";
import { alignText, joinCopiedParts, mapMarkdownSource, sliceMarkdown, sourceRangeOf } from "./markdown-source.ts";

/**
 * What copying `selected` (the `occurrence`-th match in the rendered text of `markdown`) puts on
 * the clipboard. Rendered text has no block separators, `\n` for line breaks, U+FFFC for images.
 */
function copy(markdown: string, selected: string, occurrence = 0): string {
  const map = mapMarkdownSource(markdown);
  let index = -1;
  for (let found = 0; found <= occurrence; found++) {
    index = map.text.indexOf(selected, index + 1);
    assert.notEqual(index, -1, `${JSON.stringify(selected)} is not in ${JSON.stringify(map.text)}`);
  }
  return joinCopiedParts([sliceMarkdown(map, map.from[index], map.to[index + selected.length - 1])]);
}

test("inline code the selection cuts loses its backticks; code inside the selection keeps them", () => {
  assert.equal(copy("`hello` there", "hello there"), "hello there");
  assert.equal(copy("`hello` there", "ello there"), "ello there");
  assert.equal(copy("say `hello` there", "say hel"), "say hel");
  assert.equal(copy("say `hello` there", "say hello there"), "say `hello` there");
  assert.equal(copy("`` `x` `` y", "`x` y"), "`x` y");
});

test("emphasis, strong, and strikethrough keep their markup only when wholly selected", () => {
  const markdown = "Plain **bold**, _em_, and ~~struck~~ words";
  assert.equal(copy(markdown, "ain bold, em, and struck wo"), "ain **bold**, _em_, and ~~struck~~ wo");
  assert.equal(copy(markdown, "old, em, and str"), "old, _em_, and str");
  assert.equal(copy(markdown, "bold"), "bold");
  const nested = "**bold _and em_** after";
  assert.equal(copy(nested, "bold and em after"), "bold _and em_ after");
  assert.equal(copy(nested, "bold and em"), "bold and em");
  assert.equal(copy(nested, "em after"), "em after");
});

test("links keep their destination only when the selection spans the whole link", () => {
  const markdown = 'See [the docs](https://example.com "Docs") for more.';
  assert.equal(copy(markdown, "See the docs for"), 'See [the docs](https://example.com "Docs") for');
  assert.equal(copy(markdown, "docs for"), "docs for");
  assert.equal(copy(markdown, "See the do"), "See the do");
  assert.equal(copy(markdown, "the docs"), "the docs");
  const reference = "Read [the guide][guide] now.\n\n[guide]: https://example.com";
  assert.equal(copy(reference, "Read the guide now"), "Read [the guide][guide] now");
  assert.equal(copy(reference, "guide now"), "guide now");
  const autolinks = "Open <https://example.com/a> or www.example.org today";
  assert.equal(copy(autolinks, "Open https://example.com/a or"), "Open <https://example.com/a> or");
  assert.equal(copy(autolinks, "example.com/a or www.example.org to"), "example.com/a or www.example.org to");
});

test("cells copied whole keep their pipes, so a copy spanning cells stays a table", () => {
  const table = "| Name | Value |\n|:-----|------:|\n| **a** | 1 |\n| b \\| c | 2 |";
  assert.equal(copy(table, "NameValuea1b | c2"), table);
  assert.equal(copy(table, "a1b | c"), "| **a** | 1 |\n| b \\| c |");
  // A cell copied in part brings no pipe on that side
  assert.equal(copy(table, "ameValuea"), "ame | Value |\n|:-----|------:|\n| **a** |");
  assert.equal(copy(table, "Value"), "Value");
  // Without its leading pipe this row would start `# |`, a heading
  assert.equal(copy("| # | Step |\n|---|---|\n| 1 | Run |", "#Step1Run"), "| # | Step |\n|---|---|\n| 1 | Run |");
});

test("heading markup goes when the selection starts inside the heading", () => {
  const atx = "## Install ##\n\nRun the script.";
  assert.equal(copy(atx, "Install"), "Install");
  assert.equal(copy(atx, "stallRun the"), "stall\n\nRun the");
  assert.equal(copy("Intro\n\n## Install ##\n\nRun", "IntroInstallRun"), "Intro\n\n## Install ##\n\nRun");
  assert.equal(copy("Title\n=====\n\nBody", "itleBody"), "itle\n\nBody");
  assert.equal(copy("Intro\n\nTitle\n=====\n\nBody", "IntroTitleBo"), "Intro\n\nTitle\n=====\n\nBo");
});

test("quote markers go when the selection starts inside the quote", () => {
  const markdown = "Before\n\n> First line\n> second line\n\nAfter";
  assert.equal(copy(markdown, "line\nsecond"), "line\nsecond");
  assert.equal(copy(markdown, "line\nsecond lineAfter"), "line\nsecond line\n\nAfter");
  assert.equal(copy(markdown, "BeforeFirst line\nsec"), "Before\n\n> First line\n> sec");
});

test("list items keep their markers when wholly selected; a cut item loses its indentation", () => {
  assert.equal(copy("- one\n- two\n- three", "onetwothree"), "one\n- two\n- three");
  assert.equal(copy("1. one\n2. two", "netwo"), "ne\n2. two");
  assert.equal(copy("- a\n  - b\n    more\n- c", "ab\nmorec"), "a\n- b\n  more\n- c");
  // Kept, the four-space indent would turn the paragraph into code
  assert.equal(copy("10. step\n\n    detail", "stepdetail"), "step\n\ndetail");
  assert.equal(copy("- [x] done\n- [ ] todo", "done todo"), "done\n- [ ] todo");
});

test("code blocks copy as code; a fence goes when the selection starts inside the block", () => {
  const markdown = "Setup:\n\n```sh\nnpm install\nnpm test\n```\n\nDone.";
  assert.equal(copy(markdown, "install\nnpm te"), "install\nnpm te");
  assert.equal(copy(markdown, "npm test\n"), "npm test");
  assert.equal(copy(markdown, "test\nDone"), "test\n\nDone");
  // An unclosed fence is valid Markdown: the code still reads as code
  assert.equal(copy(markdown, "Setup:npm install"), "Setup:\n\n```sh\nnpm install");
  const inList = "- Run:\n\n  ```sh\n  npm install\n  npm test\n  ```";
  assert.equal(copy(inList, "npm install\nnpm test"), "npm install\nnpm test");
  assert.equal(copy("Text\n\n    indented\n    code", "dented\ncode"), "dented\ncode");
});

test("escapes, entities, line breaks, and images copy as written", () => {
  assert.equal(copy("Tom &amp; Jerry \\*not em\\*", "& Jerry *not em*"), "&amp; Jerry \\*not em\\*");
  assert.equal(copy("first line\nsecond line", "line\nsecond"), "line\nsecond");
  assert.equal(copy("hard  \nbreak", "hard\nbreak"), "hard  \nbreak");
  assert.equal(copy('Look: ![diagram](d.png "Flow") above', "Look: \uFFFC ab"), 'Look: ![diagram](d.png "Flow") ab');
});

test("a rendered text that differs from the source still maps a selection onto it", () => {
  const markdown = "Note:\n\n```js\nrun();\n```\n\n> [!TIP]\n> Use **npm** here.";
  const map = mapMarkdownSource(markdown);
  // The renderer drops the code block's last line break and the alert marker, and titles the alert
  const rendered = "Note:run();TipUse npm here.";
  const matches = alignText(rendered, map.text);
  assert.ok(matches);
  const copyRendered = (selected: string) => {
    const start = rendered.indexOf(selected);
    const range = sourceRangeOf(map, matches, start, start + selected.length);
    return range && sliceMarkdown(map, range[0], range[1]);
  };
  assert.equal(copyRendered("run();TipUse npm"), "run();\n\n> [!TIP]\n> Use npm");
  assert.equal(copyRendered("TipUse npm here."), "Use **npm** here.");
  assert.equal(copyRendered("Tip"), null);
  assert.equal(alignText("unrelated words entirely", map.text), null);
});

test("copied pieces join with a blank line, without blank lines at their edges", () => {
  assert.equal(joinCopiedParts(["\n\nfirst\n", " \n", "  second line\n  \n"]), "first\n\n  second line");
});
