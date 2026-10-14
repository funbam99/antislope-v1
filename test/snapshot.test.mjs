import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fixture, candidate } from "./helpers.mjs";
import { captureSnapshot, validateSnapshot, freshness } from "../src/minesweeper/snapshot.ts";

test("captures exact candidate bytes, deleted rows and unchanged supporting context", (t) => {
  const f = fixture(t);
  f.git("add", "allow.ts");
  writeFileSync(join(f.repo, "allow.ts"), candidate.replace("true", "Boolean(1)"));
  const s = captureSnapshot(f.repo, f.base, ["allow.ts", "helper.ts"]);
  assert.equal(s.baseline, f.base);
  assert.equal(s.files[0].candidate, candidate.replace("true", "Boolean(1)"));
  assert.equal(s.files[0].rows.find((r) => r.kind === "delete").oldLine, 2);
  assert.equal(s.files[0].rows.find((r) => r.kind === "add").newLine, 2);
  assert.equal(s.files[1].baseline, s.files[1].candidate);
  assert.equal(
    s.files[0].candidateHash,
    createHash("sha256").update(s.files[0].candidate).digest("hex"),
  );
  assert.deepEqual(validateSnapshot(JSON.parse(JSON.stringify(s))), s);
});
test("committing unchanged bytes does not change identity or freshness", (t) => {
  const f = fixture(t);
  const s = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  f.git("add", "allow.ts");
  f.git("commit", "-qm", "candidate");
  assert.equal(freshness(f.repo, s), "current");
  assert.equal(captureSnapshot(f.repo, f.base, ["allow.ts"]).id, s.id);
  writeFileSync(join(f.repo, "allow.ts"), "changed\n");
  assert.equal(freshness(f.repo, s), "historical");
});
test("comparison branch advancement uses the shared ancestor rather than its tip", (t) => {
  const f = fixture(t);
  f.git("add", "allow.ts");
  f.git("commit", "-qm", "candidate");
  f.git("branch", "feature");
  f.git("checkout", "-q", "-b", "upstream", f.base);
  writeFileSync(join(f.repo, "helper.ts"), "export const unit = 2;\n");
  f.git("add", ".");
  f.git("commit", "-qm", "upstream change");
  f.git("checkout", "-q", "feature");
  const s = captureSnapshot(f.repo, "upstream", ["allow.ts", "helper.ts"]);
  assert.equal(s.baseline, f.base);
  assert.equal(s.files[1].baseline, "export const unit = 1;\n");
});
test("CRLF and a missing final newline survive serialization and line numbering", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "allow.ts"), "export const a = 1;\r\nexport const b = 2;");
  const s = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  assert.equal(s.files[0].candidate, "export const a = 1;\r\nexport const b = 2;");
  assert.equal(s.files[0].rows.filter((r) => r.kind === "add").at(-1).newLine, 2);
  assert.deepEqual(validateSnapshot(JSON.parse(JSON.stringify(s))), s);
});
test("literal selected paths reject traversal, symlinks, unsupported files and invalid bytes", (t) => {
  const f = fixture(t);
  for (const p of ["../allow.ts", "/allow.ts", ":(glob)*.ts", "missing.ts", "allow.js"]) {
    assert.throws(() => captureSnapshot(f.repo, f.base, [p]));
  }
  symlinkSync(join(f.repo, "allow.ts"), join(f.repo, "linked.ts"));
  assert.throws(() => captureSnapshot(f.repo, f.base, ["linked.ts"]));
  writeFileSync(join(f.repo, "allow.ts"), Buffer.from([0xff, 0xfe]));
  assert.throws(() => captureSnapshot(f.repo, f.base, ["allow.ts"]));
});
test("tampered hashes, source and diff mappings cannot enter curator validation", (t) => {
  const f = fixture(t);
  const s = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  for (const mutate of [
    (v) => (v.files[0].candidate += "x"),
    (v) => (v.files[0].candidateHash = "0".repeat(64)),
    (v) => (v.files[0].rows[0].newLine = 42),
  ]) {
    const copy = structuredClone(s);
    mutate(copy);
    assert.throws(() => validateSnapshot(copy));
  }
  assert.equal(readFileSync(join(f.repo, "allow.ts"), "utf8"), candidate);
});
