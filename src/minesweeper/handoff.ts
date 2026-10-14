import type { Annotation, Assessment, Snapshot } from "./types.js";

function prose(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>#|!]/gu, "\\$&").replace(/\r?\n/gu, "\n  ");
}
export function anchorLabel(annotation: Annotation): string {
  const a = annotation.anchor;
  if (a.kind === "change") return "Change: captured review scope";
  if (a.kind === "file") return `File: ${a.path}`;
  return `${a.kind === "baseline" ? "Deleted baseline" : "Clean candidate"}: ${a.path}:${a.line}`;
}
export function handoff(
  snapshot: Snapshot,
  status: string,
  annotations: Annotation[],
  assessments: Assessment[],
  questions: string[],
): string {
  const parts = [
    "# Minesweeper author handoff",
    "",
    `Baseline commit: ${snapshot.baseline}`,
    `Snapshot: ${snapshot.id}`,
    `Freshness at export: ${status}`,
    "",
    "Reviewed files:",
    ...snapshot.files.map((f) => `- ${prose(f.path)} — SHA-256 ${f.candidateHash}`),
    "",
    `Excluded paths: ${snapshot.excluded.length ? snapshot.excluded.map(prose).join(", ") : "none"}`,
    "",
    "Verification below concerns the captured clean snapshot. This is not a correctness certificate.",
    "",
    "## Verified findings",
  ];
  const real = assessments.filter((a) => a.kind === "real");
  if (!real.length) parts.push("No verified real issue recorded.");
  for (const result of real) {
    const note = annotations.find((a) => a.id === result.id)!;
    parts.push(
      "",
      `- ${prose(anchorLabel(note))}`,
      `  Issue: ${prose(note.constraint)}`,
      `  Trigger: ${prose(note.trigger)}`,
      `  Evidence: ${prose(result.evidence)}`,
      `  Disposition: ${result.disposition}`,
      `  Next action or reason: ${prose(result.next)}`,
    );
  }
  parts.push("", "## Questions and handoff");
  const open = [...questions];
  for (const result of assessments) {
    const note = annotations.find((a) => a.id === result.id)!;
    if (
      result.kind === "question" ||
      result.kind === "disputed" ||
      (result.kind === "real" && result.disposition !== "decline")
    )
      open.push(`${anchorLabel(note)} — ${result.next}`);
    if (result.repairNote)
      open.push(
        `${anchorLabel(note)} — Author-reported work, unverified on current code: ${result.repairNote}. Recheck before claiming resolution.`,
      );
  }
  if (status !== "current")
    open.unshift(
      "The workspace changed or could not be checked. Recheck all captured findings and references against current clean code before sharing or implementing changes.",
    );
  parts.push(
    ...(open.length ? open.map((q) => `- ${prose(q)}`) : ["No unresolved question recorded."]),
  );
  return parts.join("\n") + "\n";
}
