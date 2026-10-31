// Ctrl+Enter (Cmd+Enter on macOS) in an empty composer sends that chat's oldest queued message
// now, exactly as its row's send-now button does. With a draft typed, or nothing queued, the key
// keeps Paseo's own meaning (queue the draft while the agent runs, else send it).

import { findFiberProps } from "./fiber";

/** The composer textarea (composer/input/input.tsx) */
const COMPOSER_INPUT_SELECTOR = "[data-composer-input]";
const CHAT_SELECTOR = '[data-testid="agent-chat-scroll"]';
/** Fibers from a queue row button's host node up to its QueuedMessageRow (Pressable, View) */
const MAX_ROW_DEPTH = 30;
/** DOM levels from the textarea up to the composer area holding the queue */
const MAX_COMPOSER_DEPTH = 24;

/** QueuedMessageRow's props (composer/index.tsx); there is no test id or locale-free label */
interface QueuedMessageRowProps extends Record<string, unknown> {
  item: { id: string };
  onSendNow: (id: string) => unknown;
}

function isQueuedMessageRow(props: Record<string, unknown>): props is QueuedMessageRowProps {
  const { item, onSendNow } = props;
  return (
    typeof onSendNow === "function" &&
    !!item &&
    typeof item === "object" &&
    "id" in item &&
    typeof item.id === "string"
  );
}

/** The oldest queued row of the composer owning `input`; rows render oldest first, above the input */
function findOldestQueuedRow(input: Element): QueuedMessageRowProps | null {
  const checked = new Set<Element>();
  let ancestor = input.parentElement;
  for (let depth = 0; ancestor && depth < MAX_COMPOSER_DEPTH; depth++, ancestor = ancestor.parentElement) {
    // Climbed out of this composer: anything further belongs to the chat or another pane
    if (ancestor.querySelector(CHAT_SELECTOR) || ancestor.querySelectorAll(COMPOSER_INPUT_SELECTOR).length > 1) {
      return null;
    }
    for (const button of ancestor.querySelectorAll('[role="button"]')) {
      if (checked.has(button)) continue;
      checked.add(button);
      if (!(button.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      const row = findFiberProps(button, MAX_ROW_DEPTH, isQueuedMessageRow);
      if (row) return row;
    }
  }
  return null;
}

/** Listens for Ctrl+Enter; returns the cleanup */
export function startSendQueuedShortcut(): () => void {
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    if (event.shiftKey || event.altKey || event.isComposing || event.repeat) return;
    const input = document.activeElement?.closest(COMPOSER_INPUT_SELECTOR);
    // A typed draft is Paseo's to queue or send
    if (!(input instanceof HTMLTextAreaElement) || input.value.trim() !== "") return;
    const row = findOldestQueuedRow(input);
    if (!row) return;
    // Captured on window, before React's root listener, so the composer does not also queue the draft
    event.preventDefault();
    event.stopPropagation();
    void row.onSendNow(row.item.id);
  }
  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
