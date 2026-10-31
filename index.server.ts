import type { PluginServerContext } from "@getpaseo/plugin/server";
import { openPath, resolvePaths } from "./server/paths";
import { openPathRpc, resolvePathsRpc } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(resolvePathsRpc, resolvePaths);
  server.handle(openPathRpc, openPath);
  return () => {};
}
