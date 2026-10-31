import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { startPathLinks } from "./client/path-links";
import { startSendQueuedShortcut } from "./client/send-queued";
import { openPathRpc, resolvePathsRpc } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  // Chat text and the composer are reachable as DOM only on web and Electron
  if (Platform.OS !== "web") return () => {};
  const stopPathLinks = startPathLinks(
    async (workspaceId, paths) => (await client.rpc(resolvePathsRpc, { workspaceId, paths })).kinds,
    (path) => client.rpc(openPathRpc, { path }),
  );
  const stopSendQueued = startSendQueuedShortcut();
  return () => {
    stopSendQueued();
    stopPathLinks();
  };
}
