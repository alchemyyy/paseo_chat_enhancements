import { findFiberProps } from "./fiber";

/** Fibers between a chat node and the pane that renders it */
const MAX_PANE_DEPTH = 400;

interface PaneProviderProps extends Record<string, unknown> {
  value: { workspaceId: string };
}

function isPaneProvider(props: Record<string, unknown>): props is PaneProviderProps {
  const { value } = props;
  return (
    !!value &&
    typeof value === "object" &&
    "workspaceId" in value &&
    typeof value.workspaceId === "string" &&
    "openFileInWorkspace" in value &&
    typeof value.openFileInWorkspace === "function"
  );
}

/**
 * The workspace id of the pane containing `element`, or null. Chat DOM carries no workspace id;
 * every workspace pane renders inside the app's PaneContext (panels/pane-context.tsx), whose
 * provider fiber holds the value.
 */
export function findPaneWorkspaceId(element: Element): string | null {
  return findFiberProps(element, MAX_PANE_DEPTH, isPaneProvider)?.value.workspaceId ?? null;
}
