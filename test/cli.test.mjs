import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture, exercise } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
const cli = resolve("src/cli.ts");
const run = (args, cwd) =>
  spawnSync(
    process.execPath,
    ["--import", resolve("node_modules/tsx/dist/loader.mjs"), cli, ...args],
    { encoding: "utf8", cwd, timeout: 10000 },
  );
test("snapshot and curator validation work with relative preparation paths", (t) => {
  const f = fixture(t);
  const result = run(
    ["minesweeper", "snapshot", "--repo", f.repo, "--base", f.base, "--file", "allow.ts"],
    f.root,
  );
  assert.equal(result.status, 0, result.stderr);
  const s = JSON.parse(result.stdout);
  assert.match(s.files[0].candidate, /count >= limit/);
  writeFileSync(join(f.root, "snapshot.json"), JSON.stringify(s));
  writeFileSync(join(f.root, "exercise.json"), JSON.stringify(exercise(s)));
  const valid = run(
    ["minesweeper", "validate", "--snapshot", "snapshot.json", "--exercise", "exercise.json"],
    f.root,
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /valid/i);
  const e = exercise(s);
  e.mutation.line = 99;
  writeFileSync(join(f.root, "exercise.json"), JSON.stringify(e));
  assert.equal(
    run(
      ["minesweeper", "validate", "--snapshot", "snapshot.json", "--exercise", "exercise.json"],
      f.root,
    ).status,
    1,
  );
});
test("all author exercise failures use a generic message without private paths or lines", (t) => {
  const f = fixture(t);
  const s = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const expected =
    "The exercise could not be validated against the current code. Please contact the curator.";
  for (const value of [
    "{PRIVATE malformed",
    JSON.stringify({ ...exercise(s), mutation: { ...exercise(s).mutation, line: 99 } }),
    JSON.stringify({ ...exercise(s), snapshotId: "0".repeat(64) }),
  ]) {
    writeFileSync(join(f.root, "exercise.json"), value);
    const r = run(
      ["minesweeper", "review", "--repo", f.repo, "--exercise", "exercise.json"],
      f.root,
    );
    assert.equal(r.status, 1);
    assert.equal(r.stderr.trim(), expected);
    assert.equal(r.stdout, "");
  }
  const missing = run(
    ["minesweeper", "review", "--repo", f.repo, "--exercise", "SECRET-MISSING.json"],
    f.root,
  );
  assert.equal(missing.stderr.trim(), expected);
  assert.equal(run(["minesweeper", "review", "--repo", f.repo], f.root).status, 2);
});
test("valid review starts over relative input and SIGINT closes the server", async (t) => {
  const f = fixture(t);
  const s = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  writeFileSync(join(f.root, "exercise.json"), JSON.stringify(exercise(s)));
  const child = spawn(
    process.execPath,
    [
      "--import",
      resolve("node_modules/tsx/dist/loader.mjs"),
      cli,
      "minesweeper",
      "review",
      "--repo",
      f.repo,
      "--exercise",
      "exercise.json",
    ],
    { cwd: f.root, stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => child.kill("SIGKILL"));
  const url = await new Promise((res, rej) => {
    let output = "";
    const timer = setTimeout(() => rej(new Error("No startup URL")), 10000);
    child.stdout.on("data", (d) => {
      output += d;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\//);
      if (match) {
        clearTimeout(timer);
        res(match[0]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      rej(new Error("CLI exited " + code));
    });
  });
  assert.equal((await fetch(url + "state")).status, 200);
  const ended = new Promise((res) => child.once("exit", (code, signal) => res({ code, signal })));
  child.kill("SIGINT");
  assert.equal((await ended).code, 0);
});
