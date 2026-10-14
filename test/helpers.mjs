import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
export const baseline =
  "export function allow(count: number, limit: number): boolean {\n  return count < limit;\n}\n";
export const candidate =
  "export function allow(count: number, limit: number): boolean {\n  if (count >= limit) return false;\n  return true;\n}\n";
export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "minesweeper-test-"));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", repo]);
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(repo, "allow.ts"), baseline);
  writeFileSync(join(repo, "helper.ts"), "export const unit = 1;\n");
  git("add", ".");
  git("commit", "-qm", "baseline");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(repo, "allow.ts"), candidate);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repo, base, git };
}
export function exercise(snapshot, mutation = true) {
  return {
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
    title: "Request limit",
    requirements: "Reject when the previously accepted count reaches the limit.",
    intent: "Decide whether another request may be accepted.",
    initial: {
      prompt: "For count=3 and limit=3, what does the displayed function return?",
      displayed: mutation ? "true" : "false",
      clean: "false",
      intended: "false",
      explanation:
        "The displayed comparison accepts equality; the clean comparison rejects equality.",
    },
    followup: {
      prompt: "For count=2 and limit=3, what does the clean function return?",
      answer: "true",
      explanation: "One request remains below the limit.",
    },
    mutation: mutation
      ? {
          path: "allow.ts",
          line: 2,
          clean: "  if (count >= limit) return false;",
          replacement: "  if (count > limit) return false;",
          category: "Boundary",
          trigger: "count=3, limit=3",
          expected: "false",
          explanation: "Equality must be rejected.",
          evidence:
            "Independent truth table: 2/3 accepts; 3/3 rejects. Style reviewed against surrounding source.",
        }
      : null,
    clue: mutation ? "Consider equality at the request limit." : null,
  };
}
