import path from "node:path";

/** MSYS / Git Bash drive form on Windows: `/c/Users/...` */
const MSYS_DRIVE_PATH = /^\/([A-Za-z])\/(.*)$/s;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const UNC_PATH = /^[\\/]{2}[^\\/]/;
const HOME_PATH = /^~[\\/]/;

/**
 * The absolute host path a chat path text names, or null when the text is not an absolute path
 * on `platform`. Windows accepts drive, UNC, `~\`, and `/c/...` paths; other platforms accept
 * `/...` and `~/` paths.
 */
export function toHostPath(text: string, platform: NodeJS.Platform, home: string): string | null {
  const flavor = platform === "win32" ? path.win32 : path.posix;
  if (HOME_PATH.test(text)) return flavor.join(home, text.slice(2));
  if (platform !== "win32") return text.startsWith("/") ? flavor.normalize(text) : null;
  const msys = MSYS_DRIVE_PATH.exec(text);
  if (msys) return flavor.normalize(`${msys[1].toUpperCase()}:\\${msys[2]}`);
  if (WINDOWS_DRIVE_PATH.test(text) || UNC_PATH.test(text)) return flavor.normalize(text);
  return null;
}

/** Whether `target` is `directory` or anything below it; case-insensitive on Windows */
export function isInsideDirectory(directory: string, target: string, platform: NodeJS.Platform): boolean {
  const flavor = platform === "win32" ? path.win32 : path.posix;
  const relative = flavor.relative(directory, target);
  return relative !== ".." && !relative.startsWith(`..${flavor.sep}`) && !flavor.isAbsolute(relative);
}
