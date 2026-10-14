import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { diffRows, lines } from "./diff.js";
import { array, commit, hash, object, text } from "./validation.js";
import type { Exercise, Snapshot, SnapshotFile } from "./types.js";

export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
export const MAX_SOURCE = 128 * 1024;
export function selectedPath(value: unknown): string {
  const path = text(value, "Path", 500);
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    path.startsWith(":") ||
    /[\r\n\t]/u.test(path) ||
    !path.endsWith(".ts")
  )
    throw new Error("Unsupported selected path");
  return path;
}
function git(repo: string, args: string[]): string {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1" };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ])
    delete (env as NodeJS.ProcessEnv)[key];
  const result = spawnSync("git", ["--no-pager", "-C", repo, ...args], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024,
    env,
  });
  if (result.status !== 0) throw new Error("Git could not read the requested repository data");
  return result.stdout;
}
export function repositoryRoot(directory: string): string {
  return realpathSync(git(resolve(directory), ["rev-parse", "--show-toplevel"]).trim());
}
export function safeFile(root: string, path: string): string {
  selectedPath(path);
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("Symlinks are unsupported");
  }
  if (!lstatSync(current).isFile() || relative(root, realpathSync(current)).startsWith(".."))
    throw new Error("Unsupported file");
  return current;
}
function sourceBytes(bytes: Buffer): string {
  if (bytes.length > MAX_SOURCE || bytes.includes(0))
    throw new Error("Unsupported binary or oversized file");
  const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (lines(value).length > 2000) throw new Error("Selected file exceeds 2000 lines");
  return value;
}
function baselineFile(
  root: string,
  baseline: string,
  path: string,
): { source: string; mode: string } {
  const entry = git(root, ["ls-tree", "-z", baseline, "--", path]);
  const match = /^(100644|100755) blob ([a-f0-9]+)\t([^\0]+)\0$/u.exec(entry);
  if (!match || match[3] !== path) throw new Error(`Unsupported baseline file: ${path}`);
  const result = spawnSync("git", ["-C", root, "cat-file", "blob", match[2]!], {
    encoding: "buffer",
    timeout: 5000,
    maxBuffer: MAX_SOURCE + 1,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.status !== 0) throw new Error("Baseline source could not be read");
  return { source: sourceBytes(result.stdout), mode: match[1]! };
}
function snapshotId(baseline: string, files: SnapshotFile[]): string {
  return digest(
    JSON.stringify({
      schemaVersion: 1,
      baseline,
      files: files.map(({ path, mode, baseline: old, candidate, baselineHash, candidateHash }) => ({
        path,
        mode,
        baseline: old,
        candidate,
        baselineHash,
        candidateHash,
      })),
    }),
  );
}
function capture(
  root: string,
  baseline: string,
  comparison: string,
  paths: string[],
  head: string,
): Snapshot {
  if (!paths.length || paths.length > 12 || new Set(paths).size !== paths.length)
    throw new Error("Select 1–12 distinct files");
  const files = paths.map((input): SnapshotFile => {
    const path = selectedPath(input),
      full = safeFile(root, path);
    const old = baselineFile(root, baseline, path);
    const index = git(root, ["ls-files", "--stage", "-z", "--", path]);
    if (
      !index.startsWith(`${old.mode} `) ||
      !index.endsWith(` 0\t${path}\0`) ||
      index.split("\0").length !== 2
    )
      throw new Error(`Unsupported index file: ${path}`);
    const candidate = sourceBytes(readFileSync(full));
    return {
      path,
      mode: old.mode,
      baseline: old.source,
      candidate,
      baselineHash: digest(old.source),
      candidateHash: digest(candidate),
      rows: diffRows(old.source, candidate),
    };
  });
  if (!files.some((f) => f.baseline !== f.candidate))
    throw new Error("Select at least one changed file");
  const changed = git(root, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--name-only",
    "-z",
    baseline,
    "--",
  ])
    .split("\0")
    .filter(Boolean);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
  const excluded = [...new Set([...changed, ...untracked])]
    .filter((p) => !paths.includes(p))
    .sort();
  return {
    schemaVersion: 1,
    baseline,
    comparison,
    head,
    files,
    excluded,
    id: snapshotId(baseline, files),
  };
}
export function captureSnapshot(repo: string, base: string, paths: string[]): Snapshot {
  const root = repositoryRoot(repo);
  const comparison = git(root, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]).trim();
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const bases = git(root, ["merge-base", "--all", comparison, head]).trim().split("\n");
  if (bases.length !== 1 || !bases[0]) throw new Error("A unique merge-base is required");
  return capture(root, bases[0], comparison, paths, head);
}
export function captureBoundSnapshot(repo: string, exercise: Exercise): Snapshot {
  const root = repositoryRoot(repo);
  commit(exercise.baseline);
  return capture(
    root,
    exercise.baseline,
    exercise.comparison,
    exercise.files.map((f) => f.path),
    exercise.head,
  );
}
export function validateSnapshot(input: unknown): Snapshot {
  const value = object(input, [
    "schemaVersion",
    "id",
    "baseline",
    "comparison",
    "head",
    "files",
    "excluded",
  ]);
  if (value.schemaVersion !== 1) throw new Error("Unsupported snapshot version");
  const baseline = commit(value.baseline),
    comparison = commit(value.comparison),
    head = commit(value.head);
  const files = array(value.files, 12).map((entry): SnapshotFile => {
    const f = object(entry, [
      "path",
      "mode",
      "baseline",
      "candidate",
      "baselineHash",
      "candidateHash",
      "rows",
    ]);
    const path = selectedPath(f.path);
    if (f.mode !== "100644" && f.mode !== "100755") throw new Error("Unsupported mode");
    if (typeof f.baseline !== "string" || typeof f.candidate !== "string")
      throw new Error("Missing source");
    const old = sourceBytes(Buffer.from(f.baseline)),
      candidate = sourceBytes(Buffer.from(f.candidate));
    const baselineHash = hash(f.baselineHash),
      candidateHash = hash(f.candidateHash);
    if (digest(old) !== baselineHash || digest(candidate) !== candidateHash)
      throw new Error(`Source hash mismatch: ${path}`);
    const rows = diffRows(old, candidate);
    if (JSON.stringify(rows) !== JSON.stringify(f.rows))
      throw new Error(`Diff mapping mismatch: ${path}`);
    return { path, mode: f.mode, baseline: old, candidate, baselineHash, candidateHash, rows };
  });
  if (
    !files.length ||
    new Set(files.map((f) => f.path)).size !== files.length ||
    !files.some((f) => f.baseline !== f.candidate)
  )
    throw new Error("Invalid selected files");
  const id = hash(value.id);
  if (snapshotId(baseline, files) !== id) throw new Error("Snapshot identity mismatch");
  const excluded = array(value.excluded, 10000).map((p) => text(p, "Excluded path", 1000));
  return { schemaVersion: 1, id, baseline, comparison, head, files, excluded };
}
export function freshness(repo: string, snapshot: Snapshot): "current" | "historical" | "unknown" {
  try {
    const root = repositoryRoot(repo);
    for (const file of snapshot.files) {
      if (digest(sourceBytes(readFileSync(safeFile(root, file.path)))) !== file.candidateHash)
        return "historical";
    }
    return "current";
  } catch {
    return "unknown";
  }
}
