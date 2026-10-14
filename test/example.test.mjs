import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
import { validateExercise } from "../src/minesweeper/exercise.ts";

test("example setup creates a separate clean repository and structurally valid private exercise", (t) => {
  const result = spawnSync(process.execPath, ["examples/minesweeper/create-example.mjs"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const paths = JSON.parse(result.stdout);
  t.after(() => rmSync(paths.root, { recursive: true, force: true }));
  const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
  const e = validateExercise(JSON.parse(readFileSync(paths.exercise, "utf8")), snapshot);
  assert.equal(readFileSync(join(paths.repo, "allow.ts"), "utf8"), snapshot.files[0].candidate);
  assert.match(snapshot.files[0].candidate, /count >= limit/);
  assert.equal(e.mutation.replacement, "  if (count > limit) return false;");
  assert.equal(
    captureSnapshot(paths.repo, snapshot.baseline, ["allow.ts", "helper.ts"]).id,
    snapshot.id,
  );
});
