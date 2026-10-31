import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { openPathRpc, PathKind, resolvePathsRpc } from "../shared/contracts";
import { launchDetached } from "./launch";
import { isInsideDirectory, toHostPath } from "./host-path";
import { openInTextEditor } from "./text-editor";
import { explorerArgument } from "./windows-command";

/** An unreachable network share can stall `stat` for a long time; such a path is left unlinked */
const STAT_TIMEOUT_MS = 3000;

async function kindOf(target: string): Promise<PathKind | null> {
  const timeout = sleep(STAT_TIMEOUT_MS, null, { ref: false });
  const lookup = stat(target).then(
    (stats) => (stats.isDirectory() ? "directory" : stats.isFile() ? "file" : null),
    () => null,
  );
  return Promise.race([lookup, timeout]);
}

async function workspaceDirectory(context: PluginHandlerContext, workspaceId: string): Promise<string | null> {
  const { entries } = await context.paseo.workspaces.list({});
  const workspace = entries.find((entry) => entry.id === workspaceId);
  return workspace ? (workspace.workspaceDirectory ?? workspace.projectRootPath) : null;
}

export async function resolvePaths(
  { workspaceId, paths }: RpcInput<typeof resolvePathsRpc>,
  context: PluginHandlerContext,
): Promise<RpcOutput<typeof resolvePathsRpc>> {
  const root = workspaceId ? await workspaceDirectory(context, workspaceId) : null;
  const home = homedir();
  const kinds = await Promise.all(
    paths.map(async (text) => {
      const target = toHostPath(text, process.platform, home);
      if (!target || (root && isInsideDirectory(root, target, process.platform))) return null;
      return kindOf(target);
    }),
  );
  return { kinds };
}

export async function openPath({ path: text }: RpcInput<typeof openPathRpc>): Promise<RpcOutput<typeof openPathRpc>> {
  const target = toHostPath(text, process.platform, homedir());
  if (!target) throw new Error(`Not an absolute path on this host: ${text}`);
  const kind = await kindOf(target);
  if (!kind) throw new Error(`No file or folder at ${target}`);
  if (kind === "file") await openInTextEditor(target);
  else await openFolder(target);
  return { kind };
}

async function openFolder(target: string): Promise<void> {
  switch (process.platform) {
    case "win32":
      // Explorer parses its own command line, so the argument is passed verbatim
      await launchDetached({
        command: "explorer.exe",
        args: [explorerArgument(target, false)],
        windowsVerbatimArguments: true,
      });
      break;
    case "darwin":
      await launchDetached({ command: "open", args: [target] });
      break;
    default:
      await launchDetached({ command: "xdg-open", args: [target] });
  }
}
