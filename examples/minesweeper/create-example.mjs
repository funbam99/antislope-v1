import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { check } from "prettier";
import { captureSnapshot } from "../../dist/minesweeper/snapshot.js";
import { validateExercise } from "../../dist/minesweeper/exercise.js";

if (process.argv.slice(2).some((arg) => arg !== "--control") || process.argv.length > 3) {
  console.error("Usage: node examples/minesweeper/create-example.mjs [--control]");
  process.exit(2);
}
const control = process.argv.includes("--control");
const root = mkdtempSync(join(tmpdir(), "minesweeper-example-"));
const repo = join(root, "repo");
execFileSync("git", ["init", "-q", repo]);
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("config", "user.name", "Minesweeper Example");
git("config", "user.email", "example@example.invalid");
const baseline =
  "export function allow(count: number, limit: number): boolean {\n  return count < limit;\n}\n";
const candidate =
  "export function allow(count: number, limit: number): boolean {\n  if (count >= limit) return false;\n  return true;\n}\n";
writeFileSync(join(repo, "allow.ts"), baseline);
writeFileSync(join(repo, "helper.ts"), "export const defaultLimit = 3;\n");
git("add", ".");
git("commit", "-qm", "Example baseline");
const base = git("rev-parse", "HEAD");
writeFileSync(join(repo, "allow.ts"), candidate);
const snapshot = captureSnapshot(repo, base, ["allow.ts", "helper.ts"]);
const projected = candidate.replace("count >= limit", "count > limit");
if (!(await check(projected, { parser: "typescript", printWidth: 100 })))
  throw new Error("Example formatting check failed");
const exercise = {
  schemaVersion: 1,
  snapshotId: snapshot.id,
  baseline: snapshot.baseline,
  comparison: snapshot.comparison,
  head: snapshot.head,
  files: snapshot.files.map((f) => ({
    path: f.path,
    baselineHash: f.baselineHash,
    candidateHash: f.candidateHash,
  })),
  title: "Request limit · author review",
  requirements:
    "count is the number of requests already accepted in this window. At most limit requests may be accepted. Inputs are nonnegative integer counts and a positive integer limit. This function has no side effects.",
  intent:
    "Decide whether the next request may be accepted. Inspect the rejection path and the count definition.",
  initial: {
    prompt:
      "For count=3 and limit=3, what does the displayed function return, and what should the requirement allow?",
    displayed: control ? "false" : "true",
    clean: "false",
    intended: "false: no fourth request is allowed.",
    explanation: control
      ? "The displayed and clean versions reject equality."
      : "The displayed > comparison accepts equality; the clean >= comparison rejects it. The requirement rejects equality.",
  },
  followup: {
    prompt:
      "On the clean candidate, consider count=2, limit=3 and then count=4, limit=3. What are the return values?",
    answer: "true for count=2; false for count=4.",
    explanation:
      "The first case has capacity; the second is already over the limit. The clean >= condition rejects count=4.",
  },
  mutation: control
    ? null
    : {
        path: "allow.ts",
        line: 2,
        clean: "  if (count >= limit) return false;",
        replacement: "  if (count > limit) return false;",
        category: "Boundary",
        trigger: "count=3, limit=3",
        expected: "false",
        explanation:
          "The displayed condition accepts the fourth request at equality, contrary to the maximum accepted count.",
        evidence:
          "Manual truth table: clean 2/3=true, 3/3=false, 4/3=false; displayed 2/3=true, 3/3=true, 4/3=false. Prettier check of the full projected text passed with parser=typescript, printWidth=100. This preparation checks text and reasoning; it does not execute repository code.",
      },
  clue: control ? null : "Consider the case where the accepted count exactly equals the limit.",
};
validateExercise(exercise, snapshot);
const snapshotPath = join(root, "snapshot.json"),
  exercisePath = join(root, "exercise.json");
writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
writeFileSync(exercisePath, JSON.stringify(exercise, null, 2) + "\n");
console.log(
  JSON.stringify({ root, repo, snapshot: snapshotPath, exercise: exercisePath }, null, 2),
);
