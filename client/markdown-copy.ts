// Copying a selection of rendered chat Markdown puts its Markdown source on the clipboard as plain
// text. Each Markdown text's source comes from the React props of the component that rendered it; the
// selection is mapped onto that source through the rendered text (see markdown-source.ts).
//
// Paseo's own copy handler (assistant-selection-copy) runs first, from React's root listener, and
// writes text/html and regenerated Markdown. This listener runs after it, on window, and replaces only
// the plain text, so rich-text targets still receive the formatted HTML.

import { findFiberProps } from "./fiber";
import {
  alignText,
  joinCopiedParts,
  mapMarkdownSource,
  OBJECT_CHARACTER,
  sliceMarkdown,
  sourceRangeOf,
} from "./markdown-source";

/** The agent chat scroller (agent-stream/strategy-web.tsx); one per open chat pane */
const CHAT_SELECTOR = '[data-testid="agent-chat-scroll"]';
/** Root element of a rendered Markdown text (react-native-enriched-markdown's web renderer) */
const MARKDOWN_SELECTOR = ".enrm-text";
/**
 * Never copied: Paseo's copy buttons, icons, form controls, and the title the renderer adds to a
 * GitHub alert (`> [!NOTE]`), which is not source text
 */
const SKIPPED_SELECTOR =
  "[data-paseo-markdown-ignore], svg, input, textarea, select, script, style, noscript, .enrm-admonition > :first-child";
/** Fibers from a Markdown root element up to MarkdownRenderer's part (components/markdown/renderer.tsx) */
const MAX_SOURCE_DEPTH = 40;

/** MarkdownRenderer's props; `text` is the message's Markdown before Paseo adapts it for the renderer */
interface MarkdownSourceProps extends Record<string, unknown> {
  text: string;
}

function isMarkdownSource(props: Record<string, unknown>): props is MarkdownSourceProps {
  return typeof props.text === "string";
}

/** A Markdown root's rendered text: text nodes, line breaks as `\n`, images as OBJECT_CHARACTER */
interface RenderedText {
  text: string;
  /** Each text node, `br`, or `img` in order, and where it starts in `text` */
  nodes: Node[];
  starts: number[];
}

function collectRenderedText(root: Element): RenderedText {
  const rendered: RenderedText = { text: "", nodes: [], starts: [] };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      if (element.matches(SKIPPED_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return element.tagName === "BR" || element.tagName === "IMG" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let value = OBJECT_CHARACTER;
    if (node.nodeType === Node.TEXT_NODE) value = (node as Text).data;
    else if ((node as Element).tagName === "BR") value = "\n";
    if (!value) continue;
    rendered.nodes.push(node);
    rendered.starts.push(rendered.text.length);
    rendered.text += value;
  }
  return rendered;
}

/**
 * Where the range lies relative to a rendered character's start (or end): -1 before the range,
 * 1 after it, 0 inside. A line break or image is compared at its element.
 */
function comparePosition(range: Range, rendered: RenderedText, index: number, atEnd: boolean): number {
  let low = 0;
  let high = rendered.starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (rendered.starts[middle] <= index) low = middle;
    else high = middle - 1;
  }
  const node = rendered.nodes[low];
  if (node.nodeType !== Node.TEXT_NODE) return range.comparePoint(node, 0);
  return range.comparePoint(node, index - rendered.starts[low] + (atEnd ? 1 : 0));
}

/** The rendered characters the range selects, as [start, end) */
function selectedCharacters(range: Range, rendered: RenderedText): [number, number] {
  let low = 0;
  let high = rendered.text.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (comparePosition(range, rendered, middle, false) < 0) low = middle + 1;
    else high = middle;
  }
  const start = low;
  high = rendered.text.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (comparePosition(range, rendered, middle, true) > 0) high = middle;
    else low = middle + 1;
  }
  return [start, low];
}

let warnedMissingSource = false;

/** The Markdown of the part of `root` the range selects; null when its source is unavailable */
function selectedMarkdownOf(root: Element, range: Range): string | null {
  const source = findFiberProps(root, MAX_SOURCE_DEPTH, isMarkdownSource)?.text;
  if (source === undefined) {
    if (!warnedMissingSource) console.warn("[chat-enhancements] Markdown source not found; copying rendered text");
    warnedMissingSource = true;
    return null;
  }
  // A selection reaching past the text's start or end takes its markup there too
  const fromStart = range.comparePoint(root, 0) === 0;
  const toEnd = range.comparePoint(root, root.childNodes.length) === 0;
  if (fromStart && toEnd) return source;
  const map = mapMarkdownSource(source);
  const rendered = collectRenderedText(root);
  const matches = alignText(rendered.text, map.text);
  if (!matches) return null;
  const [first, last] = selectedCharacters(range, rendered);
  const selected = sourceRangeOf(map, matches, first, last);
  const start = fromStart ? 0 : selected?.[0];
  const end = toEnd ? source.length : selected?.[1];
  if (start === undefined || end === undefined || start >= end) return "";
  return sliceMarkdown(map, start, end);
}

/** Text between Markdown texts as the browser would copy it: visible, selectable, a line per block */
function createGapText(range: Range) {
  const blocks = new Map<Element, Element | null>();
  const copyable = new Map<Element, boolean>();
  function isCopyable(element: Element): boolean {
    let result = copyable.get(element);
    if (result === undefined) {
      result = element.checkVisibility() && getComputedStyle(element).userSelect !== "none";
      copyable.set(element, result);
    }
    return result;
  }
  function blockOf(element: Element): Element | null {
    if (blocks.has(element)) return blocks.get(element)!;
    const display = getComputedStyle(element).display;
    const block =
      display.startsWith("inline") || display === "contents"
        ? element.parentElement && blockOf(element.parentElement)
        : element;
    blocks.set(element, block);
    return block;
  }
  let text = "";
  let lastBlock: Element | null = null;
  return {
    add(node: Node): void {
      const parent = node.parentElement;
      if (!parent || !isCopyable(parent)) return;
      let value = "\n";
      if (node.nodeType === Node.TEXT_NODE) {
        const data = (node as Text).data;
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : data.length;
        value = data.slice(start, end);
      }
      if (!value) return;
      const block = blockOf(parent);
      if (text && block !== lastBlock) text += "\n";
      text += value;
      lastBlock = block;
    },
    take(): string {
      const result = text;
      text = "";
      lastBlock = null;
      return result;
    },
  };
}

/**
 * The selection as Markdown: each Markdown text it covers as source, anything between them as
 * plain text. Null when it is not within one chat or covers no Markdown, and when a source is
 * unavailable, so the copy keeps its default content.
 */
function selectedMarkdown(range: Range): string | null {
  const common = range.commonAncestorContainer;
  const ancestor = common instanceof Element ? common : common.parentElement;
  if (!ancestor?.closest(CHAT_SELECTOR)) return null;
  const single = ancestor.closest(MARKDOWN_SELECTOR);
  if (single) {
    const part = selectedMarkdownOf(single, range);
    return part === null ? null : joinCopiedParts([part]) || null;
  }

  const items: { root?: Element; node?: Node }[] = [];
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      // Recorded as the walk reaches it, which keeps document order with the text around it
      if (element.matches(MARKDOWN_SELECTOR)) {
        items.push({ root: element });
        return NodeFilter.FILTER_REJECT;
      }
      if (element.matches(SKIPPED_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return element.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) items.push({ node });
  if (!items.some((item) => item.root)) return null;

  const gap = createGapText(range);
  const parts: string[] = [];
  for (const { root, node } of items) {
    if (node) {
      gap.add(node);
      continue;
    }
    parts.push(gap.take());
    const part = selectedMarkdownOf(root!, range);
    if (part === null) return null;
    parts.push(part);
  }
  parts.push(gap.take());
  return joinCopiedParts(parts) || null;
}

function selectionHtml(range: Range): string {
  const container = document.createElement("div");
  container.append(range.cloneContents());
  return container.innerHTML;
}

/** Listens for copies of chat Markdown; returns the cleanup */
export function startMarkdownCopy(): () => void {
  function onCopy(event: ClipboardEvent): void {
    const data = event.clipboardData;
    const selection = document.getSelection();
    if (!data || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    let markdown: string | null = null;
    try {
      markdown = selectedMarkdown(range);
    } catch (error) {
      console.warn("[chat-enhancements] Markdown copy failed; copying rendered text", error);
    }
    if (!markdown) return;
    // Without Paseo's handler, the browser would have written the selection's HTML itself
    if (!event.defaultPrevented) {
      data.setData("text/html", selectionHtml(range));
      event.preventDefault();
    }
    data.setData("text/plain", markdown);
  }
  // Bubble phase on window: after React's root listener, where Paseo's handler writes its content
  window.addEventListener("copy", onCopy);
  return () => window.removeEventListener("copy", onCopy);
}
