import { lines } from "./diff.js";
import { selectedPath } from "./snapshot.js";
import { array, commit, hash, integer, object, text } from "./validation.js";
import type { Exercise, Mutation, Snapshot } from "./types.js";

export function parseExercise(input: unknown): Exercise {
  const e = object(input, [
    "schemaVersion",
    "snapshotId",
    "baseline",
    "comparison",
    "head",
    "files",
    "title",
    "requirements",
    "intent",
    "initial",
    "followup",
    "mutation",
    "clue",
  ]);
  if (e.schemaVersion !== 1) throw new Error("Unsupported exercise version");
  const initial = object(e.initial, ["prompt", "displayed", "clean", "intended", "explanation"]);
  const followup = object(e.followup, ["prompt", "answer", "explanation"]);
  let mutation: Mutation | null = null;
  if (e.mutation !== null) {
    const m = object(e.mutation, [
      "path",
      "line",
      "clean",
      "replacement",
      "category",
      "trigger",
      "expected",
      "explanation",
      "evidence",
    ]);
    mutation = {
      path: selectedPath(m.path),
      line: integer(m.line, 1, 2000),
      clean: text(m.clean, "Clean line", 4000, true),
      replacement: text(m.replacement, "Replacement", 4000, true),
      category: text(m.category, "Category", 100),
      trigger: text(m.trigger),
      expected: text(m.expected),
      explanation: text(m.explanation),
      evidence: text(m.evidence),
    };
    if (
      /[\r\n]/u.test(mutation.clean + mutation.replacement) ||
      mutation.clean === mutation.replacement
    )
      throw new Error(`Invalid single-line replacement: ${mutation.path}:${mutation.line}`);
  }
  const files = array(e.files, 12).map((value) => {
    const f = object(value, ["path", "baselineHash", "candidateHash"]);
    return {
      path: selectedPath(f.path),
      baselineHash: hash(f.baselineHash),
      candidateHash: hash(f.candidateHash),
    };
  });
  if (!files.length || new Set(files.map((f) => f.path)).size !== files.length)
    throw new Error("Invalid exercise file selection");
  const clue = mutation ? text(e.clue) : null;
  if (!mutation && e.clue !== null) throw new Error("A control cannot have a location clue");
  return {
    schemaVersion: 1,
    snapshotId: hash(e.snapshotId),
    baseline: commit(e.baseline),
    comparison: commit(e.comparison),
    head: commit(e.head),
    files,
    title: text(e.title, "Title", 200),
    requirements: text(e.requirements, "Requirements", 12000),
    intent: text(e.intent),
    initial: {
      prompt: text(initial.prompt),
      displayed: text(initial.displayed),
      clean: text(initial.clean),
      intended: text(initial.intended),
      explanation: text(initial.explanation),
    },
    followup: {
      prompt: text(followup.prompt),
      answer: text(followup.answer),
      explanation: text(followup.explanation),
    },
    mutation,
    clue,
  };
}
export function validateExercise(input: unknown, snapshot: Snapshot): Exercise {
  const e = parseExercise(input);
  if (
    e.snapshotId !== snapshot.id ||
    e.baseline !== snapshot.baseline ||
    e.files.length !== snapshot.files.length
  )
    throw new Error("Exercise snapshot mismatch");
  for (let i = 0; i < e.files.length; i++) {
    const file = e.files[i]!,
      captured = snapshot.files[i]!;
    if (
      file.path !== captured.path ||
      file.baselineHash !== captured.baselineHash ||
      file.candidateHash !== captured.candidateHash
    )
      throw new Error(`File binding mismatch: ${file.path}`);
  }
  if (e.mutation) {
    const m = e.mutation,
      file = snapshot.files.find((f) => f.path === m.path);
    if (!file || lines(file.candidate)[m.line - 1] !== m.clean)
      throw new Error(`Clean line mismatch: ${m.path}:${m.line}`);
    const row = file.rows.find((r) => r.kind === "add" && r.newLine === m.line);
    if (!row) throw new Error(`Mutation is outside changed candidate lines: ${m.path}:${m.line}`);
    if (row.pair !== null && lines(file.baseline)[row.pair - 1] === m.replacement)
      throw new Error(`Replacement equals paired baseline: ${m.path}:${m.line}`);
  }
  return e;
}
