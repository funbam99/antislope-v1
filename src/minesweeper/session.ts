import { hunks, lines } from "./diff.js";
import { randomBytes } from "node:crypto";
import { digest, freshness } from "./snapshot.js";
import { handoff } from "./handoff.js";
import { validateSnapshot } from "./snapshot.js";
import { validateExercise } from "./exercise.js";
import { array, integer, object, text } from "./validation.js";
import type { Anchor, Annotation, Assessment, Exercise, Snapshot } from "./types.js";

export class ReviewSession {
  private phase: "reading" | "submitted" | "revealed" | "completed" = "reading";
  private status: "current" | "historical" | "unknown" = "current";
  private annotations: Annotation[] = [];
  private firstPass: { prediction: string; annotations: Annotation[]; noFindings: string } | null =
    null;
  private hintLevel = 0;
  private assessments: Assessment[] | null = null;
  private region: { kind: string; note: string } | null = null;
  private referenceDispute = "";
  private followup: { prediction: string; dispute: string } | null = null;
  private card: string | null = null;
  private readerId = randomBytes(16).toString("hex");
  readonly snapshot: Snapshot;
  private readonly exercise: Exercise;
  readonly preview: boolean;
  private repo: string | undefined;

  constructor(snapshot: Snapshot, exercise: Exercise, repo?: string, preview = false) {
    this.snapshot = structuredClone(snapshot);
    this.exercise = structuredClone(exercise);
    this.repo = repo;
    this.preview = preview;
  }
  private journal: { action: string; input: unknown }[] = [];
  // Private recovery data. Never serve this through a reader or discussion endpoint.
  checkpoint(): Record<string, unknown> {
    return structuredClone({
      schemaVersion: 1,
      snapshot: this.snapshot,
      exercise: this.exercise,
      repo: this.repo,
      readerId: this.readerId,
      status: this.status,
      journal: this.journal,
    });
  }
  static restore(input: unknown): ReviewSession {
    const saved = object(input, [
      "schemaVersion",
      "snapshot",
      "exercise",
      "repo",
      "readerId",
      "status",
      "journal",
    ]);
    if (
      saved.schemaVersion !== 1 ||
      typeof saved.readerId !== "string" ||
      !/^[a-f0-9]{32}$/u.test(saved.readerId) ||
      !["current", "historical", "unknown"].includes(saved.status as string) ||
      (saved.repo !== undefined && typeof saved.repo !== "string")
    )
      throw new Error("Invalid recovery state");
    const snapshot = validateSnapshot(saved.snapshot),
      exercise = validateExercise(saved.exercise, snapshot);
    const session = new ReviewSession(snapshot, exercise);
    session.status = saved.status as ReviewSession["status"];
    for (const entry of array(saved.journal, 10000)) {
      const item = object(entry, ["action", "input"]);
      if (item.action === "export") session.export();
      else session.transition(text(item.action, "Action", 100), item.input);
    }
    session.readerId = saved.readerId;
    session.repo = saved.repo as string | undefined;
    return session;
  }
  private checkFreshness(): void {
    if (this.repo && this.status === "current" && this.phase !== "completed")
      this.status = freshness(this.repo, this.snapshot);
  }
  agentView(): Record<string, unknown> {
    this.checkFreshness();
    const result: Record<string, unknown> = {
      phase: this.phase,
      freshness: this.status,
      readerId: this.readerId,
    };
    if (this.phase !== "revealed" && this.phase !== "completed") return result;
    result.requirements = this.exercise.requirements;
    result.files = this.snapshot.files.map(({ path, baseline, candidate }) => ({
      path,
      baseline,
      candidate,
    }));
    result.annotations = structuredClone(this.annotations);
    result.assessments = structuredClone(this.assessments);
    result.referenceDispute = this.referenceDispute;
    result.initialReference = {
      displayed: this.exercise.initial.displayed,
      clean: this.exercise.initial.clean,
      intended: this.exercise.initial.intended,
      explanation: this.exercise.initial.explanation,
    };
    if (this.exercise.mutation) {
      const { path, line, trigger, expected, explanation, evidence } = this.exercise.mutation;
      result.mutationReference = { path, line, trigger, expected, explanation, evidence };
    } else result.mutationReference = null;
    if (this.followup) result.followupReference = structuredClone(this.exercise.followup);
    if (this.card) result.handoff = this.card;
    return result;
  }
  // The organizer sees the captured reading version only, never its clean counterpart or oracle fields.
  reviewDiscussionView(): Record<string, unknown> {
    return {
      requirements: this.exercise.requirements,
      files: this.snapshot.files.map((file) => {
        const candidate = lines(file.candidate),
          mutation = this.exercise.mutation;
        if (mutation?.path === file.path) candidate[mutation.line - 1] = mutation.replacement;
        return { path: file.path, candidate };
      }),
    };
  }
  discussionView(): Record<string, unknown> {
    const reader = this.view();
    return {
      phase: reader.phase,
      freshness: reader.freshness,
      readerId: this.readerId,
      title: reader.title,
      requirements: reader.requirements,
      intent: reader.intent,
      initialPrompt: reader.initialPrompt,
      files: reader.files.map((file: Record<string, unknown>) => ({
        path: file.path,
        baseline: file.baseline,
        candidate: file.candidate,
        hunks: file.hunks,
      })),
      annotations: reader.annotations,
      ...(this.phase === "revealed" || this.phase === "completed"
        ? { followupPrompt: reader.followupPrompt }
        : {}),
    };
  }
  view(): Record<string, any> {
    this.checkFreshness();
    const revealed = this.phase === "revealed" || this.phase === "completed";
    const files = this.snapshot.files.map((f) => {
      const candidate = lines(f.candidate);
      const rows = f.rows.map((r) => ({ ...r }));
      const m = this.exercise.mutation;
      if (!revealed && m?.path === f.path) {
        candidate[m.line - 1] = m.replacement;
        for (const row of rows) if (row.newLine === m.line) row.text = m.replacement;
      }
      return {
        path: f.path,
        baseline: lines(f.baseline),
        candidate,
        hunks: hunks(rows),
        ...(revealed ? { baselineHash: f.baselineHash, candidateHash: f.candidateHash } : {}),
      };
    });
    const result: Record<string, any> = {
      phase: this.phase,
      preview: this.preview,
      freshness: this.status,
      title: this.exercise.title,
      requirements: this.exercise.requirements,
      intent: this.exercise.intent,
      version: {
        baseline: this.snapshot.baseline,
        headAtPreparation: this.snapshot.head,
        readerId: this.readerId,
        ...(revealed ? { snapshot: this.snapshot.id } : {}),
        ...(revealed && this.followup ? { exercise: digest(JSON.stringify(this.exercise)) } : {}),
        excluded: [...this.snapshot.excluded],
      },
      files,
      initialPrompt: this.exercise.initial.prompt,
      annotations: structuredClone(this.annotations),
      firstPass: structuredClone(this.firstPass),
      hintLevel: this.hintLevel,
      assessments: structuredClone(this.assessments),
      region: structuredClone(this.region),
      referenceDispute: this.referenceDispute,
    };
    if (revealed) {
      result.mutationReference = structuredClone(this.exercise.mutation);
      result.initialReference = {
        displayed: this.exercise.initial.displayed,
        clean: this.exercise.initial.clean,
        intended: this.exercise.initial.intended,
        explanation: this.exercise.initial.explanation,
      };
      result.followupPrompt = this.exercise.followup.prompt;
      result.followup = structuredClone(this.followup);
      if (this.followup)
        result.followupReference = {
          answer: this.exercise.followup.answer,
          explanation: this.exercise.followup.explanation,
        };
    }
    return result;
  }
  private anchor(input: unknown): Anchor {
    const a = object(input, ["kind", "path", "line"]);
    if (a.kind === "change") {
      if (a.path !== undefined || a.line !== undefined) throw new Error("Invalid change anchor");
      return { kind: "change" };
    }
    const file = this.snapshot.files.find((f) => f.path === a.path);
    if (!file) throw new Error("Anchor is outside selected files");
    if (a.kind === "file" && a.line === undefined) return { kind: "file", path: file.path };
    if (a.kind !== "candidate" && a.kind !== "baseline") throw new Error("Invalid anchor kind");
    const line = integer(
      a.line,
      1,
      lines(a.kind === "candidate" ? file.candidate : file.baseline).length,
    );
    if (a.kind === "baseline" && !file.rows.some((r) => r.kind === "delete" && r.oldLine === line))
      throw new Error("Baseline anchor is not a deleted row");
    return { kind: a.kind, path: file.path, line };
  }
  private notes(input: unknown): Annotation[] {
    const notes = array(input, 50).map((value) => {
      const a = object(value, ["id", "anchor", "constraint", "trigger", "uncertainty"]);
      return {
        id: text(a.id, "Annotation ID", 100),
        anchor: this.anchor(a.anchor),
        constraint: text(a.constraint),
        trigger: text(a.trigger),
        uncertainty: text(a.uncertainty, "Uncertainty", 4000, true),
      };
    });
    if (new Set(notes.map((a) => a.id)).size !== notes.length)
      throw new Error("Duplicate annotation IDs");
    return notes;
  }
  transition(action: string, input: unknown): unknown {
    const result = this.applyTransition(action, input);
    this.journal.push({ action, input: structuredClone(input) });
    return result;
  }
  private applyTransition(action: string, input: unknown): unknown {
    if (this.preview || this.phase === "completed")
      throw new Error("This reader cannot change session state");
    this.checkFreshness();
    if (action === "submit") {
      if (this.phase !== "reading") throw new Error("First pass is already submitted");
      const value = object(input, ["prediction", "annotations", "noFindings"]);
      const prediction = text(value.prediction),
        notes = this.notes(value.annotations);
      const noFindings = text(value.noFindings, "No-findings explanation", 4000, notes.length > 0);
      this.firstPass = { prediction, annotations: structuredClone(notes), noFindings };
      this.annotations = notes;
      this.phase = "submitted";
    } else if (action === "revise") {
      if (this.phase === "reading") throw new Error("Submit first pass before revising");
      const value = object(input, ["annotations"]),
        notes = this.notes(value.annotations);
      if (this.annotations.some((old) => !notes.some((a) => a.id === old.id)))
        throw new Error("Keep findings and record a disposition instead of deleting them");
      this.annotations = notes;
      this.assessments = null;
    } else if (action === "hint") {
      object(input, []);
      if (this.phase !== "submitted") throw new Error("Hints require a submitted first pass");
      const next = this.hintLevel + 1;
      if (next > 3 || (next > 1 && !this.exercise.mutation))
        throw new Error("No further hint is available");
      this.hintLevel = next;
      if (next === 1) return { level: next, count: this.exercise.mutation ? 1 : 0 };
      if (next === 2) return { level: next, category: this.exercise.mutation!.category };
      return { level: next, clue: this.exercise.clue };
    } else if (action === "reveal") {
      object(input, []);
      if (this.phase !== "submitted") throw new Error("Reveal requires a submitted first pass");
      this.phase = "revealed";
    } else if (action === "assess") {
      if (this.phase !== "revealed") throw new Error("Assessment requires reveal");
      const value = object(input, ["assessments", "region", "referenceDispute"]);
      const assessments = array(value.assessments, 50).map((entry): Assessment => {
        const a = object(entry, ["id", "kind", "evidence", "disposition", "next", "repairNote"]);
        const id = text(a.id, "ID", 100);
        if (!this.annotations.some((note) => note.id === id)) throw new Error("Unknown finding");
        const kind = text(a.kind),
          disposition = text(a.disposition);
        if (
          !["real", "question", "exercise", "false-positive", "disputed"].includes(kind) ||
          !["fix", "test", "decline", "question", "none"].includes(disposition)
        )
          throw new Error("Invalid assessment");
        if (kind === "real" && disposition === "none")
          throw new Error("A real issue needs a disposition");
        const evidence = text(a.evidence, "Evidence", 4000, kind !== "real");
        const next = text(a.next, "Next action or reason", 4000, kind === "exercise");
        if (kind === "question" && disposition !== "question")
          throw new Error("Questions must be handed over");
        return {
          id,
          kind: kind as Assessment["kind"],
          disposition: disposition as Assessment["disposition"],
          evidence,
          next,
          repairNote: text(a.repairNote, "Unverified repair note", 4000, true),
        };
      });
      if (
        assessments.length !== this.annotations.length ||
        new Set(assessments.map((a) => a.id)).size !== assessments.length
      )
        throw new Error("Assess every finding once");
      const regionInput = object(value.region, ["kind", "note"]);
      const kind = text(regionInput.kind);
      if (
        !(
          this.exercise.mutation ? ["explained", "reread", "handoff", "disputed"] : ["none"]
        ).includes(kind)
      )
        throw new Error("Record the region outcome");
      const region = {
        kind,
        note: text(regionInput.note, "Region outcome", 4000, kind === "none"),
      };
      const referenceDispute = text(value.referenceDispute, "Reference dispute", 4000, true);
      this.assessments = assessments;
      this.region = region;
      this.referenceDispute = referenceDispute;
    } else if (action === "followup") {
      if (this.phase !== "revealed" || this.followup)
        throw new Error("Follow-up must be submitted once after reveal");
      const value = object(input, ["prediction", "dispute"]);
      this.followup = {
        prediction: text(value.prediction),
        dispute: text(value.dispute, "Dispute", 4000, true),
      };
    } else if (action === "followup-dispute") {
      if (!this.followup || this.phase !== "revealed")
        throw new Error("Read the follow-up reference first");
      const value = object(input, ["dispute"]);
      this.followup.dispute = text(value.dispute, "Dispute", 4000, true);
    } else throw new Error("Unknown session action");
    return this.view();
  }
  export(): string {
    if (this.preview) throw new Error("Preview cannot export");
    if (this.card !== null) return this.card;
    this.checkFreshness();
    if (this.phase !== "revealed" || !this.assessments || !this.region || !this.followup)
      throw new Error("Complete assessment and follow-up before export");
    const questions: string[] = [];
    if (this.referenceDispute)
      questions.push(`Reference disputed; requirement needs review: ${this.referenceDispute}`);
    if (this.followup.dispute)
      questions.push(`Clean-code scenario needs clarification: ${this.followup.dispute}`);
    if (this.region.kind === "handoff" || this.region.kind === "disputed")
      questions.push(this.region.note);
    this.card = handoff(this.snapshot, this.status, this.annotations, this.assessments, questions);
    this.phase = "completed";
    this.journal.push({ action: "export", input: {} });
    return this.card;
  }
}
