import assert from "node:assert/strict";
import { test } from "node:test";
import { findPathCandidates, folderOf, joinRelativePath, selectPaths } from "./path-scan.ts";

const startsOf = (text: string) => findPathCandidates(text).map(({ start }) => text.slice(start, start + 6));

test("a path ends at any later space, so names with spaces can be matched", () => {
  const [candidate] = findPathCandidates("see C:\\Program Files\\Paseo\\Paseo.exe here");
  assert.equal(candidate.start, 4);
  assert.deepEqual(candidate.texts, [
    "C:\\Program Files\\Paseo\\Paseo.exe here",
    "C:\\Program Files\\Paseo\\Paseo.exe",
    "C:\\Program",
  ]);
});

test("trailing punctuation and line suffixes are offered stripped", () => {
  const [candidate] = findPathCandidates("(at /tmp/a b.ts:12:3).");
  assert.deepEqual(candidate.texts, [
    "/tmp/a b.ts:12:3).",
    "/tmp/a b.ts:12:3)",
    "/tmp/a b.ts:12:3",
    "/tmp/a b.ts",
    "/tmp/a",
  ]);
});

test("roots inside URLs, words, and relative paths do not start a path", () => {
  assert.deepEqual(startsOf("https://example.com/a/b and/or ./src/x a/b"), []);
  assert.deepEqual(startsOf("C:/Users/x \\\\server\\share\\f ~/notes /c/Users"), [
    "C:/Use",
    "\\\\serv",
    "~/note",
    "/c/Use",
  ]);
});

test("quotes and newlines end a path; JSON-escaped separators start only one path", () => {
  const candidates = findPathCandidates('"C:\\\\Users\\\\me\\\\a.txt",\n/var/log');
  assert.deepEqual(
    candidates.map(({ texts }) => texts),
    [["C:\\\\Users\\\\me\\\\a.txt"], ["/var/log"]],
  );
});

test("the longest existing text wins and later roots inside it are skipped", () => {
  const text = "C:\\Program Files\\App C:\\Other";
  const existing: Record<string, "file" | "directory"> = {
    "C:\\Program Files\\App": "directory",
    "C:\\Program": "directory",
    "C:\\Other": "file",
  };
  const matches = selectPaths(findPathCandidates(text), (path) => existing[path]);
  assert.deepEqual(
    matches.map(({ text: path, kind, start, end }) => ({ path, kind, start, end })),
    [
      { path: "C:\\Program Files\\App", kind: "directory", start: 0, end: 20 },
      { path: "C:\\Other", kind: "file", start: 21, end: 29 },
    ],
  );
  const nested = selectPaths(findPathCandidates("/a/b /c"), (path) => (path === "/a/b /c" ? "file" : "directory"));
  assert.deepEqual(nested.map(({ text: path }) => path), ["/a/b /c"]);
});

test("relative paths join a named folder, or a named file's folder, in its separator style", () => {
  const folder = folderOf({ text: "C:\\x\\pair\\", kind: "directory" })!;
  assert.deepEqual(joinRelativePath(folder, "NOTES-1.md"), ["C:\\x\\pair\\NOTES-1.md"]);
  assert.deepEqual(joinRelativePath(folderOf({ text: "C:\\x\\pair", kind: "directory" })!, "./a/b.md"), [
    "C:\\x\\pair\\a/b.md",
  ]);
  assert.deepEqual(joinRelativePath(folderOf({ text: "/srv/app/README.md", kind: "file" })!, "lib.ts:12"), [
    "/srv/app/lib.ts:12",
    "/srv/app/lib.ts",
  ]);
});

test("URLs, absolute paths, and texts with spaces are not relative paths", () => {
  for (const text of ["https://a.b/c", "mailto:x@y", "C:\\a", "C:/a", "/a", "\\\\s\\x", "~/a", "#top", "a b.md", ""]) {
    assert.deepEqual(joinRelativePath("/base", text), [], text);
  }
});
