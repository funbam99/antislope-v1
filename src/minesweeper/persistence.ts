import {
  mkdirSync,
  lstatSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export const defaultStorageRoot = join(homedir(), ".local", "state", "antislope", "sessions");
export function recoveryPath(id: string, root = defaultStorageRoot): string {
  if (!/^[a-f0-9]{48}$/u.test(id)) throw new Error("Invalid session ID");
  return join(root, id);
}
function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("Recovery storage must be private");
}
export function writeRecovery(id: string, data: unknown, root = defaultStorageRoot): void {
  const repo = (data as { session?: { repo?: string } }).session?.repo;
  if (repo) {
    let ancestor = resolve(root);
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    const actualRoot = resolve(realpathSync(ancestor), relative(ancestor, resolve(root)));
    const rel = relative(existsSync(repo) ? realpathSync(repo) : resolve(repo), actualRoot);
    if (!rel || (!rel.startsWith(".." + "/") && !isAbsolute(rel)))
      throw new Error("Recovery storage must be outside the reviewed repository");
  }
  privateDirectory(root);
  const directory = recoveryPath(id, root);
  privateDirectory(directory);
  const temporary = join(directory, "checkpoint-" + randomBytes(8).toString("hex") + ".tmp");
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(data));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, join(directory, "checkpoint.json"));
    const dir = openSync(directory, "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {}
    throw error;
  }
}
export function readRecovery(id: string, root = defaultStorageRoot): Record<string, any> {
  const directory = recoveryPath(id, root);
  for (const path of [root, directory]) {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
      throw new Error("Invalid recovery directory");
  }
  const path = join(directory, "checkpoint.json"),
    info = lstatSync(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 64 * 1024 * 1024
  )
    throw new Error("Invalid recovery file");
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  if (
    value.schemaVersion !== 1 ||
    value.sessionId !== id ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535
  )
    throw new Error("Invalid checkpoint");
  return value;
}
