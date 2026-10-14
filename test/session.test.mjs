import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, exercise } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
import { validateExercise } from "../src/minesweeper/exercise.ts";
import { ReviewSession } from "../src/minesweeper/session.ts";
function setup(t, mutation = true) {
  const f = fixture(t);
  const snapshot = captureSnapshot(f.repo, f.base, ["allow.ts", "helper.ts"]);
  const e = exercise(snapshot, mutation);
  return {
    ...f,
    snapshot,
    e,
    session: new ReviewSession(snapshot, validateExercise(e, snapshot), f.repo),
  };
}
const annotation = (id, anchor) => ({
  id,
  anchor,
  constraint: "The permission check may have been removed.",
  trigger: "An unauthorized request.",
  uncertainty: "Requires requirement review.",
});
const submit = (s, annotations = []) =>
  s.transition("submit", {
    prediction: "I expect true at equality.",
    annotations,
    noFindings: annotations.length ? "" : "No issue identified independently.",
  });
const assessment = (id, kind = "question") => ({
  id,
  kind,
  evidence: kind === "real" ? "Compared the clean snapshot to the stated requirement." : "",
  disposition: "question",
  next: "Confirm the permission requirement before shipping.",
  repairNote: "",
});

test("pre-reveal diff and full files use substituted text and disclose no reference or identity", (t) => {
  const { session } = setup(t);
  const view = session.view();
  const serialized = JSON.stringify(view);
  assert.equal(view.files[0].candidate[1], "  if (count > limit) return false;");
  for (const secret of [
    "  if (count >= limit) return false;",
    "Independent truth table",
    "Equality must be rejected.",
    "Consider equality",
    '"displayed":',
    '"mutation":',
  ])
    assert.equal(serialized.includes(secret), false, secret);
  assert.throws(() => session.transition("reveal", {}));
  assert.throws(() => session.transition("hint", {}));
  assert.throws(() => session.export());
});
test("submission freezes first pass; hints and references only unlock in order", (t) => {
  const { session } = setup(t);
  submit(session);
  assert.equal(session.transition("hint", {}).count, 1);
  assert.equal(JSON.stringify(session.view()).includes("Boundary"), false);
  assert.equal(session.transition("hint", {}).category, "Boundary");
  assert.equal(session.transition("hint", {}).clue, "Consider equality at the request limit.");
  session.transition("reveal", {});
  const revealed = session.view();
  assert.equal(revealed.initialReference.displayed, "true");
  assert.equal(revealed.initialReference.clean, "false");
  assert.equal(revealed.followupReference, undefined);
  session.transition("followup", { prediction: "true", dispute: "" });
  assert.equal(session.view().followupReference.answer, "true");
});
test("all anchor kinds preserve their version and historical changes retain findings", (t) => {
  const { session, repo } = setup(t);
  const annotations = [
    annotation("a", { kind: "candidate", path: "allow.ts", line: 3 }),
    annotation("b", { kind: "baseline", path: "allow.ts", line: 2 }),
    annotation("c", { kind: "file", path: "helper.ts" }),
    annotation("d", { kind: "change" }),
  ];
  submit(session, annotations);
  writeFileSync(join(repo, "allow.ts"), "export const repaired = true;\n");
  session.transition("reveal", {});
  assert.equal(session.view().freshness, "historical");
  assert.deepEqual(session.view().annotations, annotations);
  assert.equal(session.view().files[0].candidate[1], "  if (count >= limit) return false;");
  assert.throws(() =>
    session.transition("assess", {
      assessments: annotations.map((a) => ({ ...assessment(a.id, "real"), evidence: "" })),
      region: { kind: "reread", note: "Compared the boundary." },
      referenceDispute: "",
    }),
  );
  session.transition("assess", {
    assessments: annotations.map((a) => assessment(a.id)),
    region: { kind: "handoff", note: "Recheck the boundary on current code." },
    referenceDispute: "",
  });
  session.transition("followup", { prediction: "true", dispute: "" });
  const card = session.export();
  assert.match(card, /historical/i);
  assert.match(card, /baseline.*allow\.ts.*2/);
  assert.match(card, /File: helper\.ts/);
  assert.match(card, /Change:/);
  for (const secret of [
    "Independent truth table",
    "Equality must be rejected.",
    "Hint",
    "mutation",
    "I expect true at equality.",
  ])
    assert.equal(card.includes(secret), false);
  assert.equal(session.view().phase, "completed");
  assert.equal(session.export(), card);
});
test("invalid anchors, lost annotations and unresolved real findings cannot complete", (t) => {
  const { session } = setup(t);
  for (const anchor of [
    { kind: "baseline", path: "allow.ts", line: 1 },
    { kind: "candidate", path: "allow.ts", line: 99 },
    { kind: "file", path: "outside.ts" },
  ])
    assert.throws(() => submit(session, [annotation("bad", anchor)]));
  submit(session, [annotation("a", { kind: "change" })]);
  assert.throws(() => session.transition("revise", { annotations: [] }));
  session.transition("reveal", {});
  assert.throws(() =>
    session.transition("assess", {
      assessments: [{ ...assessment("a", "real"), disposition: "none" }],
      region: { kind: "reread", note: "Boundary reread." },
      referenceDispute: "",
    }),
  );
  assert.throws(() => session.export());
});
test("zero-injection and disputed reference exercises can finish without invented findings", (t) => {
  const { session } = setup(t, false);
  submit(session);
  assert.equal(session.transition("hint", {}).count, 0);
  session.transition("reveal", {});
  session.transition("assess", {
    assessments: [],
    region: { kind: "none", note: "" },
    referenceDispute: "The requirement needs clarification.",
  });
  session.transition("followup", {
    prediction: "Uncertain about the count definition.",
    dispute: "Please confirm the requirement.",
  });
  const card = session.export();
  assert.match(card, /requirement needs clarification/);
  assert.equal(card.includes("0 injected"), false);
});
test("validation rejects multiline, same-baseline and non-diff mutations before rendering", (t) => {
  const { snapshot, e } = setup(t);
  for (const mutate of [
    (v) => (v.mutation.replacement += "\n"),
    (v) => (v.mutation.line = 1),
    (v) => (v.mutation.replacement = "  return count < limit;"),
    (v) => (v.mutation.clean = "wrong"),
  ]) {
    const copy = structuredClone(e);
    mutate(copy);
    assert.throws(() => validateExercise(copy, snapshot));
  }
});
test("preview cannot submit, hint, reveal or export even through direct transitions", (t) => {
  const { snapshot, e } = setup(t);
  const preview = new ReviewSession(snapshot, e, undefined, true);
  for (const action of ["submit", "hint", "reveal", "followup", "assess"])
    assert.throws(() => preview.transition(action, {}));
  assert.throws(() => preview.export());
  assert.equal(JSON.stringify(preview.view()).includes("Independent truth table"), false);
});

test("reader version metadata cannot serve as a clean-content oracle before reveal", (t) => {
  const { session, snapshot } = setup(t);
  const initial = session.view();
  assert.equal(initial.files[0].candidateHash, undefined);
  assert.equal(initial.version.snapshot, undefined);
  assert.equal(initial.version.exercise, undefined);
  assert.equal(JSON.stringify(initial).includes(snapshot.id), false);
  submit(session);
  session.transition("reveal", {});
  assert.equal(session.view().files[0].candidateHash, snapshot.files[0].candidateHash);
  assert.equal(session.view().version.snapshot, snapshot.id);
});

test("disputed findings and region questions survive handoff without private reference data", (t) => {
  const { session } = setup(t);
  submit(session, [annotation("dispute", { kind: "change" })]);
  session.transition("reveal", {});
  session.transition("assess", {
    assessments: [
      {
        ...assessment("dispute", "disputed"),
        next: "Confirm whether equality is an accepted request under the contract.",
      },
    ],
    region: { kind: "disputed", note: "The meaning of count needs an owner decision." },
    referenceDispute: "",
  });
  session.transition("followup", {
    prediction: "Unclear until the contract is settled.",
    dispute: "",
  });
  const card = session.export();
  assert.match(card, /Confirm whether equality/);
  assert.match(card, /meaning of count needs/);
  assert.equal(card.includes("No unresolved question recorded."), false);
  assert.equal(card.includes("Independent truth table"), false);
});

test("an exercise digest cannot leak the still-hidden follow-up reference after initial reveal", (t) => {
  const { session } = setup(t);
  submit(session);
  session.transition("reveal", {});
  assert.equal(session.view().version.exercise, undefined);
  session.transition("followup", { prediction: "true", dispute: "" });
  assert.match(session.view().version.exercise, /^[a-f0-9]{64}$/);
});
