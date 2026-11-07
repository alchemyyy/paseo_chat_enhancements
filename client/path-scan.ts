import type { PathKind } from "../shared/contracts";

/** A place in chat text where an absolute path may start, with every text it may end as */
export interface PathCandidate {
  start: number;
  /** Path texts beginning at `start`, longest first */
  texts: string[];
}

export interface PathMatch {
  start: number;
  end: number;
  text: string;
  kind: PathKind;
}

/**
 * Drive (`C:\`, `C:/`), UNC (`\\server\share\`), home (`~/`), and POSIX (`/x`) roots. The
 * lookbehind keeps roots inside words, URLs (`https://`), relative paths (`./`, `a/b`), and
 * longer paths from starting a second match.
 */
const PATH_ROOT = /(?<![\w.~$%@:\\/<-])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s"<>|*?]+[\\/]|~[\\/]|\/(?=[^\s/\\]))/g;
/** Characters no path in chat contains: controls, tabs, newlines, and Windows-reserved punctuation */
const PATH_STOP = /[\u0000-\u001f"<>|*?`\u2028\u2029]/;
const SPACE = /[ \u00a0]/;
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}>]$/;
/** `:12`, `:12:3`, `:12-20` after a file name */
const LINE_SUFFIX = /:\d+(?::\d+)?(?:-\d+)?$/;
/** Texts that are not relative paths: URLs, drive paths, and rooted, home, fragment, or query texts */
const NOT_RELATIVE = /^(?:[A-Za-z][\w+.-]*:(?!\d)|[\\/~#?])|[\s"<>|*?]/;
const SEPARATOR = /[\\/]/;
/** Spaces a path may contain, as in `C:\Program Files\...`; longer runs are prose */
const MAX_SPACES = 8;
const MAX_PATH_LENGTH = 400;
const MAX_TEXTS_PER_CANDIDATE = 48;

/** Every possible absolute path in `text`; which ones exist is decided by the host */
export function findPathCandidates(text: string): PathCandidate[] {
  const candidates: PathCandidate[] = [];
  for (const root of text.matchAll(PATH_ROOT)) {
    const start = root.index;
    // A drive root alone (`C:\`) is a folder; other roots need a name after them
    const minLength = /^[A-Za-z]:/.test(root[0]) ? root[0].length : root[0].length + 1;
    const texts = new Set<string>();
    let spaces = 0;
    let end = start + root[0].length;
    const limit = Math.min(text.length, start + MAX_PATH_LENGTH);
    for (; end <= limit; end++) {
      const character = text[end];
      const atBoundary = end === limit || PATH_STOP.test(character) || SPACE.test(character);
      if (atBoundary) addTrimmedTexts(text.slice(start, end), minLength, texts);
      if (end === limit || PATH_STOP.test(character)) break;
      if (SPACE.test(character) && ++spaces > MAX_SPACES) break;
    }
    if (texts.size === 0) continue;
    const sorted = [...texts].sort((left, right) => right.length - left.length);
    candidates.push({ start, texts: sorted.slice(0, MAX_TEXTS_PER_CANDIDATE) });
  }
  return candidates;
}

/** `raw` and each shorter text left by dropping a line suffix or one trailing punctuation mark */
function addTrimmedTexts(raw: string, minLength: number, into: Set<string>): void {
  let value = raw;
  while (value.length >= minLength) {
    into.add(value);
    const withoutLine = value.replace(LINE_SUFFIX, "");
    if (withoutLine !== value) value = withoutLine;
    else if (TRAILING_PUNCTUATION.test(value)) value = value.slice(0, -1);
    else break;
  }
}

/** The longest existing path at each candidate, skipping candidates inside an earlier match */
export function selectPaths(
  candidates: readonly PathCandidate[],
  kindOf: (text: string) => PathKind | null | undefined,
): PathMatch[] {
  const matches: PathMatch[] = [];
  let covered = 0;
  for (const { start, texts } of candidates) {
    if (start < covered) continue;
    for (const text of texts) {
      const kind = kindOf(text);
      if (!kind) continue;
      matches.push({ start, end: start + text.length, text, kind });
      covered = start + text.length;
      break;
    }
  }
  return matches;
}

/** The folder an existing path puts relative paths in: a folder itself, or a file's parent */
export function folderOf(match: Pick<PathMatch, "text" | "kind">): string | null {
  if (match.kind === "directory") return match.text;
  const end = Math.max(match.text.lastIndexOf("\\"), match.text.lastIndexOf("/"));
  return end > 0 ? match.text.slice(0, end + 1) : null;
}

/** Absolute texts `relative` may name inside `folder`: as written, then without a line suffix */
export function joinRelativePath(folder: string, relative: string): string[] {
  if (!relative || NOT_RELATIVE.test(relative)) return [];
  const name = relative.replace(/^\.[\\/]/, "");
  const separator = folder.includes("\\") ? "\\" : "/";
  const joined = SEPARATOR.test(folder.at(-1) ?? "") ? folder + name : folder + separator + name;
  const withoutLine = joined.replace(LINE_SUFFIX, "");
  return withoutLine === joined ? [joined] : [joined, withoutLine];
}
