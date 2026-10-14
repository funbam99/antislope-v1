export interface DiffRow {
  kind: "context" | "delete" | "add";
  oldLine: number | null;
  newLine: number | null;
  text: string;
  pair: number | null;
}
export interface SnapshotFile {
  path: string;
  mode: string;
  baseline: string;
  candidate: string;
  baselineHash: string;
  candidateHash: string;
  rows: DiffRow[];
}
export interface Snapshot {
  schemaVersion: 1;
  id: string;
  baseline: string;
  comparison: string;
  head: string;
  files: SnapshotFile[];
  excluded: string[];
}
export interface Mutation {
  path: string;
  line: number;
  clean: string;
  replacement: string;
  category: string;
  trigger: string;
  expected: string;
  explanation: string;
  evidence: string;
}
export interface Exercise {
  schemaVersion: 1;
  snapshotId: string;
  baseline: string;
  comparison: string;
  head: string;
  files: { path: string; baselineHash: string; candidateHash: string }[];
  title: string;
  requirements: string;
  intent: string;
  initial: {
    prompt: string;
    displayed: string;
    clean: string;
    intended: string;
    explanation: string;
  };
  followup: { prompt: string; answer: string; explanation: string };
  mutation: Mutation | null;
  clue: string | null;
}
export type Anchor =
  | { kind: "candidate" | "baseline"; path: string; line: number }
  | { kind: "file"; path: string }
  | { kind: "change" };
export interface Annotation {
  id: string;
  anchor: Anchor;
  constraint: string;
  trigger: string;
  uncertainty: string;
}
export interface Assessment {
  id: string;
  kind: "real" | "question" | "exercise" | "false-positive" | "disputed";
  evidence: string;
  disposition: "fix" | "test" | "decline" | "question" | "none";
  next: string;
  repairNote: string;
}
