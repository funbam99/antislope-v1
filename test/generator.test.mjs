import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fixture, exercise } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
import { generateExercise } from "../src/minesweeper/generator.ts";
import { ReviewSession } from "../src/minesweeper/session.ts";
import { startServer } from "../src/minesweeper/server.ts";
import { assertNoKnownManagedConfig } from "../src/minesweeper/generator-host.ts";

test("known managed configuration and invalid host paths fail closed", async (t) => {
  const f = fixture(t);
  await assertNoKnownManagedConfig([join(f.root, "missing")]);
  await assert.rejects(assertNoKnownManagedConfig([join(f.repo, "allow.ts")]));
  await assert.rejects(assertNoKnownManagedConfig([f.repo]));
  await assert.rejects(assertNoKnownManagedConfig([join(f.repo, "allow.ts", "child")]));
});

function worker(root, snapshot, mode = "success") {
  const e = exercise(snapshot);
  const { title, intent, initial, followup, mutation, clue } = e;
  const content = { title, intent, initial, followup, mutation, clue };
  if (mode === "contract") content.requirements = "GENERATOR-OVERRIDE";
  if (mode === "outside") content.mutation.path = "helper.ts";
  if (mode === "baseline") content.mutation.replacement = "  return count < limit;";
  const path = join(root, `worker-${mode}.mjs`);
  writeFileSync(
    path,
    `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(join(root, "worker-cwd"))},process.cwd());
fs.writeFileSync(${JSON.stringify(join(root, "worker-args"))},JSON.stringify(args));
process.stdin.resume();
process.stdin.on('end',()=>{
process.stdout.write('PRIVATE-STDOUT: replacement >');
process.stderr.write('PRIVATE-STDERR: count=3');
${mode === "fail" ? "process.exit(1);" : `fs.writeFileSync(args[args.indexOf('--output-last-message')+1],${JSON.stringify(mode === "malformed" ? "PRIVATE-MALFORMED" : JSON.stringify(content))});`}
${mode === "hang" ? "setInterval(()=>{},1000);" : ""}
});
`,
    { mode: 0o700 },
  );
  return path;
}

test("private worker validates content, binds the contract, cleans temporary files and leaves target unchanged", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const before = f.git("diff", "--binary");
  const result = await generateExercise(snapshot, "Independent user contract", {
    executable: worker(f.root, snapshot),
  });
  assert.equal(result.requirements, "Independent user contract");
  assert.equal(result.snapshotId, snapshot.id);
  assert.equal(result.mutation.line, 2);
  const args = JSON.parse(readFileSync(join(f.root, "worker-args"), "utf8"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ignore-rules"));
  assert.ok(args.includes("--no-daemon"));
  assert.ok(args.includes("--ephemeral"));
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(f.git("diff", "--binary"), before);
  assert.equal(existsSync(readFileSync(join(f.root, "worker-cwd"), "utf8")), false);
});

for (const mode of ["fail", "malformed", "contract", "outside", "baseline", "hang"])
  test(`worker ${mode} produces only a generic error`, async (t) => {
    const f = fixture(t),
      snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
    await assert.rejects(
      generateExercise(snapshot, "Contract", {
        executable: worker(f.root, snapshot, mode),
        timeoutMs: mode === "hang" ? 500 : 10000,
      }),
      /^Error: Exercise preparation failed\. No private generator output was released\.$/,
    );
    assert.equal(existsSync(readFileSync(join(f.root, "worker-cwd"), "utf8")), false);
  });

test("agent route is opaque until author reveal and gates follow-up answers", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(snapshot, exercise(snapshot), f.repo);
  const server = await startServer(session);
  t.after(() => server.close());
  const get = async () => (await fetch(server.url + "agent")).json();
  const first = await get();
  assert.deepEqual(Object.keys(first).sort(), ["freshness", "phase", "readerId"]);
  session.transition("submit", {
    prediction: "A user guess",
    annotations: [],
    noFindings: "None found",
  });
  session.transition("hint", {});
  assert.deepEqual(Object.keys(await get()).sort(), Object.keys(first).sort());
  session.transition("reveal", {});
  const revealed = await get();
  assert.equal(revealed.files[0].candidate, snapshot.files[0].candidate);
  assert.equal(revealed.initialReference.clean, "false");
  assert.equal(revealed.followupReference, undefined);
  assert.equal(JSON.stringify(revealed).includes('"replacement"'), false);
  session.transition("followup", { prediction: "false", dispute: "" });
  assert.equal((await get()).followupReference.answer, "true");
});
