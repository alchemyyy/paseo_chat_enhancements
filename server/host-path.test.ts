import assert from "node:assert/strict";
import { test } from "node:test";
import { isInsideDirectory, toHostPath } from "./host-path.ts";

test("Windows accepts drive, UNC, home, and Git Bash drive paths only", () => {
  const home = "C:\\Users\\me";
  assert.equal(toHostPath("C:/Users/me//a.txt", "win32", home), "C:\\Users\\me\\a.txt");
  assert.equal(toHostPath("\\\\server\\share\\x", "win32", home), "\\\\server\\share\\x");
  assert.equal(toHostPath("~/notes", "win32", home), "C:\\Users\\me\\notes");
  assert.equal(toHostPath("/c/Program Files/x", "win32", home), "C:\\Program Files\\x");
  assert.equal(toHostPath("/usr/bin", "win32", home), null);
});

test("POSIX hosts accept rooted and home paths but not Windows drives", () => {
  assert.equal(toHostPath("/tmp//a/../b", "linux", "/home/me"), "/tmp/b");
  assert.equal(toHostPath("~/x", "darwin", "/Users/me"), "/Users/me/x");
  assert.equal(toHostPath("C:\\x", "linux", "/home/me"), null);
});

test("inside means the folder or below it, ignoring case on Windows", () => {
  assert.equal(isInsideDirectory("C:\\Proj", "c:\\proj\\src\\a.ts", "win32"), true);
  assert.equal(isInsideDirectory("C:\\Proj", "C:\\Proj", "win32"), true);
  assert.equal(isInsideDirectory("C:\\Proj", "C:\\Proj2\\a.ts", "win32"), false);
  assert.equal(isInsideDirectory("C:\\Proj", "D:\\Proj\\a.ts", "win32"), false);
  assert.equal(isInsideDirectory("/home/me/proj", "/home/me/Proj/a", "linux"), false);
  assert.equal(isInsideDirectory("/home/me/proj", "/home/me/proj/..x/a", "linux"), true);
});
