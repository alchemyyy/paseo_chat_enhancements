import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_PATH_TEXT_LENGTH = 1024;
export const MAX_PATHS_PER_RESOLVE = 256;

const PathTextSchema = z.string().min(1).max(MAX_PATH_TEXT_LENGTH);

export const PathKindSchema = z.enum(["file", "directory"]);
export type PathKind = z.infer<typeof PathKindSchema>;

/** Which chat path texts name an existing file or folder on the daemon host outside the workspace */
export const resolvePathsRpc = defineRpc({
  name: "paths.resolve",
  input: z.object({
    /** Workspace whose folder is excluded; null when the chat's workspace is unknown */
    workspaceId: z.string().nullable(),
    /** Absolute path texts exactly as written in chat */
    paths: z.array(PathTextSchema).max(MAX_PATHS_PER_RESOLVE),
  }),
  output: z.object({
    /** One per input path, in order; null when it does not exist, is not absolute, or is inside the workspace */
    kinds: z.array(PathKindSchema.nullable()),
  }),
});

/** Opens a file in the default text editor, or a folder in the file browser, on the daemon host */
export const openPathRpc = defineRpc({
  name: "paths.open",
  input: z.object({ path: PathTextSchema }),
  output: z.object({ kind: PathKindSchema }),
});
