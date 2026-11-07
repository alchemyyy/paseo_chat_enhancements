// Links absolute paths in chat without touching the chat DOM: React owns those text nodes, and
// splitting them into <a> elements would break its updates. Paths are drawn with the CSS Custom
// Highlight API and clicks are hit-tested against the highlighted ranges instead.

import { MAX_PATHS_PER_RESOLVE, type PathKind } from "../shared/contracts";
import { findPaneWorkspaceId } from "./pane-workspace";
import {
  findPathCandidates,
  folderOf,
  joinRelativePath,
  selectPaths,
  type PathCandidate,
  type PathMatch,
} from "./path-scan";

export type ResolvePaths = (workspaceId: string | null, paths: string[]) => Promise<(PathKind | null)[]>;
export type OpenPath = (path: string) => Promise<unknown>;

/** The agent chat scroller (agent-stream/strategy-web.tsx); one per open chat pane */
const CHAT_SELECTOR = '[data-testid="agent-chat-scroll"]';
/** A chat row; a message's blocks may be split over several rows sharing one id */
const MESSAGE_ROW_ATTRIBUTE = "data-message-id";
const LINK_HIGHLIGHT = "chat-enhancements-path";
const HOVER_HIGHLIGHT = "chat-enhancements-path-hover";
const HOVER_CLASS = "chat-enhancements-path-hover";
const SCAN_DELAY_MS = 150;
/** Paths that did not exist are asked about again after this, since agents create files */
const MISSING_RETRY_MS = 15_000;
const MAX_KNOWN_PATHS = 50_000;
const ERROR_DISPLAY_MS = 4000;

/** Elements whose text continues the surrounding line; any other element starts a new one */
const INLINE_TAGS: Record<string, true> = {
  SPAN: true, CODE: true, STRONG: true, EM: true, B: true, I: true, U: true, S: true, DEL: true,
  INS: true, MARK: true, SMALL: true, SUB: true, SUP: true, KBD: true, SAMP: true, VAR: true,
  ABBR: true, CITE: true, Q: true, TIME: true, LABEL: true, FONT: true,
};
/** Text never linked: existing links, form fields, and non-text content */
const SKIPPED_TAGS: Record<string, true> = {
  A: true, TEXTAREA: true, INPUT: true, SELECT: true, SCRIPT: true, STYLE: true, NOSCRIPT: true, svg: true,
};

/** Consecutive text nodes that read as one line of text */
interface TextGroup {
  block: Element;
  nodes: Text[];
  /** Offset of each node's text in `text` */
  starts: number[];
  text: string;
  candidates: PathCandidate[];
}

interface PathLink {
  range: Range;
  text: string;
  kind: PathKind;
}

function nearestBlock(element: Element | null): Element | null {
  while (element && INLINE_TAGS[element.tagName]) element = element.parentElement;
  return element;
}

/** Groups of the text under `root`; text inside existing links is left out unless `withLinks` */
function collectGroups(root: Element, withLinks = false): TextGroup[] {
  const groups: TextGroup[] = [];
  let current: TextGroup | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      const skipped = SKIPPED_TAGS[element.tagName] && !(withLinks && element.tagName === "A");
      if (skipped || (element as HTMLElement).isContentEditable) {
        current = null;
        return NodeFilter.FILTER_REJECT;
      }
      if (!INLINE_TAGS[element.tagName]) current = null;
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const block = nearestBlock(textNode.parentElement);
    if (!block) continue;
    if (!current || current.block !== block) {
      current = { block, nodes: [], starts: [], text: "", candidates: [] };
      groups.push(current);
    }
    current.starts.push(current.text.length);
    current.nodes.push(textNode);
    current.text += textNode.data;
  }
  for (const group of groups) group.candidates = findPathCandidates(group.text);
  return groups.filter((group) => group.candidates.length > 0);
}

/** The rows of every message in or around `root`, by message id */
function messageRowsOf(chat: Element, root: Element): Element[][] {
  const ids = new Set<string>();
  const enclosing = root.closest(`[${MESSAGE_ROW_ATTRIBUTE}]`)?.getAttribute(MESSAGE_ROW_ATTRIBUTE);
  if (enclosing) ids.add(enclosing);
  for (const row of root.querySelectorAll(`[${MESSAGE_ROW_ATTRIBUTE}]`)) {
    const id = row.getAttribute(MESSAGE_ROW_ATTRIBUTE);
    if (id) ids.add(id);
  }
  return [...ids].map((id) => [...chat.querySelectorAll(`[${MESSAGE_ROW_ATTRIBUTE}="${CSS.escape(id)}"]`)]);
}

/**
 * Paseo's own links whose text is a relative path, such as `NOTES.md` in code. Paseo looks those
 * up only inside the workspace, so ones naming files elsewhere do nothing when clicked.
 */
function relativeLinksIn(rows: Element[]): HTMLAnchorElement[] {
  return rows.flatMap((row) =>
    [...row.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((anchor) => {
      const href = anchor.getAttribute("href");
      return href !== null && anchor.textContent === href && joinRelativePath("/", href).length > 0;
    }),
  );
}

/** False once React changed or replaced any of the group's text nodes */
function isUnchanged(group: TextGroup): boolean {
  let text = "";
  for (const node of group.nodes) {
    if (!node.isConnected) return false;
    text += node.data;
  }
  return text === group.text;
}

function rangeOf(group: TextGroup, match: PathMatch): Range {
  const range = document.createRange();
  let startSet = false;
  for (let index = 0; index < group.nodes.length; index++) {
    const node = group.nodes[index];
    const nodeStart = group.starts[index];
    const nodeEnd = nodeStart + node.data.length;
    if (!startSet && match.start < nodeEnd) {
      range.setStart(node, match.start - nodeStart);
      startSet = true;
    }
    if (startSet && match.end <= nodeEnd) {
      range.setEnd(node, match.end - nodeStart);
      break;
    }
  }
  return range;
}

/** Remembers what the host said about each path text, per workspace */
function createPathKinds(resolve: ResolvePaths) {
  const known = new Map<string, { kind: PathKind | null; at: number }>();
  const inflight = new Map<string, Promise<void>>();
  const keyOf = (workspaceId: string | null, text: string) => `${workspaceId ?? ""}\n${text}`;

  async function request(workspaceId: string | null, texts: string[]): Promise<void> {
    let kinds: (PathKind | null)[] = [];
    try {
      kinds = await resolve(workspaceId, texts);
    } catch (error) {
      console.warn("[chat-enhancements] Path lookup failed", error);
    }
    if (known.size > MAX_KNOWN_PATHS) known.clear();
    const at = Date.now();
    texts.forEach((text, index) => {
      const key = keyOf(workspaceId, text);
      known.set(key, { kind: kinds[index] ?? null, at });
      inflight.delete(key);
    });
  }

  return {
    kindOf: (workspaceId: string | null, text: string) => known.get(keyOf(workspaceId, text))?.kind ?? null,
    /** Asks the host about every text it has not answered for recently */
    async load(workspaceId: string | null, texts: Iterable<string>): Promise<void> {
      const now = Date.now();
      const waits: Promise<void>[] = [];
      const missing: string[] = [];
      for (const text of texts) {
        const key = keyOf(workspaceId, text);
        const entry = known.get(key);
        if (entry && (entry.kind || now - entry.at < MISSING_RETRY_MS)) continue;
        const pending = inflight.get(key);
        if (pending) waits.push(pending);
        else missing.push(text);
      }
      for (let offset = 0; offset < missing.length; offset += MAX_PATHS_PER_RESOLVE) {
        const chunk = missing.slice(offset, offset + MAX_PATHS_PER_RESOLVE);
        const pending = request(workspaceId, chunk);
        for (const text of chunk) inflight.set(keyOf(workspaceId, text), pending);
        waits.push(pending);
      }
      await Promise.all(waits);
    },
  };
}

function createTooltip(): HTMLDivElement {
  const tooltip = document.createElement("div");
  Object.assign(tooltip.style, {
    position: "fixed",
    zIndex: "2147483647",
    pointerEvents: "none",
    display: "none",
    maxWidth: "480px",
    padding: "4px 8px",
    borderRadius: "6px",
    background: "rgba(24, 24, 27, 0.94)",
    color: "#fafafa",
    font: "12px/1.4 system-ui, sans-serif",
    overflowWrap: "anywhere",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.35)",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(tooltip);
  return tooltip;
}

function styleSheetText(linkColor: string | null): string {
  const color = linkColor ? `color: ${linkColor};` : "";
  return `
::highlight(${LINK_HIGHLIGHT}) { ${color} text-decoration: underline dotted; }
::highlight(${HOVER_HIGHLIGHT}) { ${color} text-decoration: underline solid; }
html.${HOVER_CLASS}, html.${HOVER_CLASS} * { cursor: pointer !important; }
`;
}

/** Links absolute paths outside the workspace in every chat; returns the cleanup */
export function startPathLinks(resolve: ResolvePaths, open: OpenPath): () => void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) {
    console.warn("[chat-enhancements] CSS Custom Highlight API unavailable; path links are off");
    return () => {};
  }
  const kinds = createPathKinds(resolve);
  const links = new Map<Element, PathLink[]>();
  const linkHighlight = new Highlight();
  const hoverHighlight = new Highlight();
  hoverHighlight.priority = 1;
  CSS.highlights.set(LINK_HIGHLIGHT, linkHighlight);
  CSS.highlights.set(HOVER_HIGHLIGHT, hoverHighlight);
  const style = document.createElement("style");
  style.textContent = styleSheetText(null);
  document.head.appendChild(style);
  const tooltip = createTooltip();
  const workspaces = new WeakMap<Element, string>();

  let linkColor: string | null = null;
  let hovered: PathLink | null = null;
  let tooltipLocked = false;
  let pointer: { x: number; y: number; target: EventTarget | null } | null = null;
  let frame = 0;
  const pending = new Set<Element>();
  let timer: number | undefined;
  let scanning = false;
  let stopped = false;

  /** Paseo's own link color, read from any link it rendered, so ours match */
  function learnLinkColor(): void {
    if (linkColor) return;
    const anchor = document.querySelector(`${CHAT_SELECTOR} a[href]`);
    if (!anchor) return;
    linkColor = getComputedStyle(anchor).color;
    style.textContent = styleSheetText(linkColor);
  }

  function workspaceOf(chat: Element): string | null {
    const cached = workspaces.get(chat);
    if (cached) return cached;
    const workspaceId = findPaneWorkspaceId(chat);
    if (workspaceId) workspaces.set(chat, workspaceId);
    return workspaceId;
  }

  function removeLinks(block: Element): void {
    for (const link of links.get(block) ?? []) {
      linkHighlight.delete(link.range);
      if (link === hovered) setHovered(null);
    }
    links.delete(block);
  }

  /** Relative links in one message, each with the absolute texts it may name, in folder order */
  async function relativeTargets(workspaceId: string | null, rows: Element[]) {
    const anchors = relativeLinksIn(rows);
    if (anchors.length === 0) return [];
    // The folders the message names are where its relative paths live
    const groups = rows.flatMap((row) => collectGroups(row, true));
    await kinds.load(workspaceId, groups.flatMap((group) => group.candidates.flatMap((candidate) => candidate.texts)));
    const folders = new Set<string>();
    for (const group of groups) {
      for (const match of selectPaths(group.candidates, (text) => kinds.kindOf(workspaceId, text))) {
        const folder = folderOf(match);
        if (folder) folders.add(folder);
      }
    }
    const targets = anchors.map((anchor) => {
      const href = anchor.getAttribute("href") ?? "";
      return { anchor, href, texts: [...folders].flatMap((folder) => joinRelativePath(folder, href)) };
    });
    await kinds.load(workspaceId, targets.flatMap((target) => target.texts));
    return targets;
  }

  async function scanRegion(root: Element): Promise<void> {
    const chat = root.closest(CHAT_SELECTOR);
    if (!chat) return;
    const workspaceId = workspaceOf(chat);
    const groups = collectGroups(root);
    const messages = messageRowsOf(chat, root);
    const [, ...targetLists] = await Promise.all([
      kinds.load(workspaceId, groups.flatMap((group) => group.candidates.flatMap((candidate) => candidate.texts))),
      ...messages.map((rows) => relativeTargets(workspaceId, rows)),
    ]);
    if (stopped) return;
    const rows = messages.flat();
    for (const block of [...links.keys()]) {
      // A relative link may be relinked by a scan of any row of its message
      const relativeLink = block.tagName === "A" && rows.some((row) => row.contains(block));
      if (root.contains(block) || relativeLink) removeLinks(block);
    }
    for (const group of groups) {
      // A changed group was queued again by the observer and is linked by that scan
      if (!isUnchanged(group)) continue;
      const matches = selectPaths(group.candidates, (text) => kinds.kindOf(workspaceId, text));
      if (matches.length === 0) continue;
      const blockLinks = links.get(group.block) ?? [];
      for (const match of matches) {
        const range = rangeOf(group, match);
        blockLinks.push({ range, text: match.text, kind: match.kind });
        linkHighlight.add(range);
      }
      links.set(group.block, blockLinks);
    }
    for (const { anchor, href, texts } of targetLists.flat()) {
      if (!anchor.isConnected || anchor.textContent !== href) continue;
      const text = texts.find((candidate) => kinds.kindOf(workspaceId, candidate));
      const kind = text && kinds.kindOf(workspaceId, text);
      if (!text || !kind) continue;
      const range = document.createRange();
      range.selectNodeContents(anchor);
      links.set(anchor, [{ range, text, kind }]);
      linkHighlight.add(range);
    }
  }

  async function scanPending(): Promise<void> {
    timer = undefined;
    if (scanning) return;
    scanning = true;
    try {
      while (pending.size > 0 && !stopped) {
        const roots = [...pending].filter((root) => root.isConnected);
        pending.clear();
        for (const block of [...links.keys()]) {
          if (!block.isConnected) removeLinks(block);
        }
        learnLinkColor();
        // A root inside another root is covered by the outer scan
        const outermost = roots.filter((root) => !roots.some((other) => other !== root && other.contains(root)));
        await Promise.all(outermost.map(scanRegion));
      }
    } finally {
      scanning = false;
    }
  }

  function schedule(root: Element): void {
    pending.add(root);
    if (!timer && !scanning) timer = window.setTimeout(scanPending, SCAN_DELAY_MS);
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target) continue;
      if (target.closest(CHAT_SELECTOR)) {
        const block = nearestBlock(target);
        if (block) schedule(block);
        continue;
      }
      for (const added of record.addedNodes) {
        if (!(added instanceof Element)) continue;
        if (added.matches(CHAT_SELECTOR)) schedule(added);
        else added.querySelectorAll(CHAT_SELECTOR).forEach(schedule);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.querySelectorAll(CHAT_SELECTOR).forEach(schedule);

  function linkAt(x: number, y: number, target: EventTarget | null): PathLink | null {
    if (!(target instanceof Element)) return null;
    const block = nearestBlock(target);
    for (const link of (block && links.get(block)) || []) {
      for (const rect of link.range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return link;
      }
    }
    return null;
  }

  function placeTooltip(x: number, y: number): void {
    const { innerWidth, innerHeight } = window;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(4, Math.min(x + 12, innerWidth - width - 4))}px`;
    tooltip.style.top = `${y + 18 + height > innerHeight ? y - height - 8 : y + 18}px`;
  }

  function setHovered(link: PathLink | null): void {
    if (link === hovered) return;
    hovered = link;
    hoverHighlight.clear();
    tooltipLocked = false;
    if (!link) {
      document.documentElement.classList.remove(HOVER_CLASS);
      tooltip.style.display = "none";
      return;
    }
    hoverHighlight.add(link.range);
    document.documentElement.classList.add(HOVER_CLASS);
    tooltip.textContent = `${link.kind === "file" ? "Open in text editor" : "Open in file browser"}: ${link.text}`;
    tooltip.style.display = "block";
  }

  function updateHover(): void {
    frame = 0;
    if (!pointer) return setHovered(null);
    setHovered(linkAt(pointer.x, pointer.y, pointer.target));
    if (hovered) placeTooltip(pointer.x, pointer.y);
  }

  function onPointerMove(event: PointerEvent): void {
    pointer = { x: event.clientX, y: event.clientY, target: event.target };
    if (!frame) frame = requestAnimationFrame(updateHover);
  }

  function onPointerLeave(): void {
    pointer = null;
    setHovered(null);
  }

  function showError(link: PathLink, error: unknown): void {
    console.error("[chat-enhancements] Could not open", link.text, error);
    if (hovered !== link) return;
    tooltip.textContent = `Could not open: ${error instanceof Error ? error.message : String(error)}`;
    tooltipLocked = true;
    setTimeout(() => {
      if (!tooltipLocked || hovered !== link) return;
      tooltipLocked = false;
      setHovered(null);
    }, ERROR_DISPLAY_MS);
  }

  function onClick(event: MouseEvent): void {
    if (event.button !== 0 || event.defaultPrevented) return;
    const link = linkAt(event.clientX, event.clientY, event.target);
    if (!link) return;
    // Releasing a text selection drag over a path selects; it does not open
    if (!(getSelection()?.isCollapsed ?? true)) return;
    // Captured on window, before React's root listener, so Pressables under the path stay idle
    event.preventDefault();
    event.stopImmediatePropagation();
    open(link.text).catch((error: unknown) => showError(link, error));
  }

  // Scrolling moves text away from the pointer; the next move recomputes the hover
  const onScroll = () => setHovered(null);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("click", onClick, true);
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });

  return () => {
    stopped = true;
    observer.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onPointerMove);
    document.documentElement.removeEventListener("pointerleave", onPointerLeave);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("scroll", onScroll, true);
    document.documentElement.classList.remove(HOVER_CLASS);
    CSS.highlights.delete(LINK_HIGHLIGHT);
    CSS.highlights.delete(HOVER_HIGHLIGHT);
    style.remove();
    tooltip.remove();
  };
}
