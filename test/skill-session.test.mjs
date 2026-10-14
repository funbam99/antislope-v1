import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { fixture, exercise } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";

const helper = resolve("antislope/scripts/session.mjs");
for (const mode of ["success", "fail", "malformed"])
  test(`skill helper intercepts worker streams on ${mode}`, async (t) => {
    const f = fixture(t),
      snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
    const e = exercise(snapshot);
    const content = Object.fromEntries(
      ["title", "intent", "initial", "followup", "mutation", "clue"].map((key) => [key, e[key]]),
    );
    const worker = join(f.root, "worker.mjs"),
      requirements = join(f.root, "requirements.txt");
    writeFileSync(requirements, "Reject at the limit.");
    writeFileSync(
      worker,
      `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(join(f.root, "cwd"))},process.cwd());\nprocess.stdin.resume();process.stdin.on('end',()=>{console.log('PRIVATE-STDOUT');console.error('PRIVATE-STDERR');${mode === "fail" ? "process.exit(1);" : `fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],${JSON.stringify(mode === "malformed" ? "PRIVATE-MALFORMED" : JSON.stringify(content))});`}});`,
      { mode: 0o700 },
    );
    const before = f.git("diff", "--binary"),
      index = readFileSync(join(f.repo, ".git/index")),
      config = readFileSync(join(f.repo, ".git/config"));
    const child = spawn(process.execPath, [
      helper,
      "run",
      "--repo",
      f.repo,
      "--base",
      f.base,
      "--file",
      "allow.ts",
      "--requirements-file",
      requirements,
      "--codex",
      worker,
    ]);
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const closed = once(child, "close");
    if (mode === "success") {
      const ready = await new Promise((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error("No ready URL")), 10000);
        child.stdout.on("data", () => {
          const row = stdout.split("\n").find((line) => line.includes('"ready"'));
          if (row) {
            clearTimeout(timer);
            resolveReady(JSON.parse(row));
          }
        });
      });
      const status = JSON.parse(
        execFileSync(process.execPath, [helper, "status", "--url", ready.url], {
          encoding: "utf8",
        }),
      );
      assert.equal(status.phase, "reading");
      assert.deepEqual(Object.keys(status).sort(), ["freshness", "phase", "readerId"]);
      child.kill("SIGINT");
    }
    const [code] = await closed;
    assert.equal(code, mode === "success" ? 0 : 1);
    assert.equal(stdout.includes("PRIVATE"), false);
    assert.equal(stderr, "");
    assert.equal(existsSync(readFileSync(join(f.root, "cwd"), "utf8")), false);
    assert.equal(f.git("diff", "--binary"), before);
    assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
    assert.deepEqual(readFileSync(join(f.repo, ".git/config")), config);
  });

test("missing relocated runtime and invalid status URL fail without private diagnostics", () => {
  for (const args of [
    ["status", "--url", "http://example.invalid/"],
    ["discuss", "--url", "http://example.invalid/"],
    ["run", "--repo", ".", "--base", "HEAD", "--file", "x.ts", "--requirements-file", "missing"],
  ]) {
    assert.throws(
      () =>
        execFileSync(process.execPath, [helper, ...args], {
          env: { ...process.env, ANTISLOPE_RUNTIME_ROOT: "/nonexistent-antislope" },
          stdio: ["ignore", "pipe", "pipe"],
        }),
      (error) => {
        assert.equal(error.status, 1);
        assert.equal(error.stderr.toString(), "");
        assert.equal(JSON.parse(error.stdout.toString()).status, "unavailable");
        return true;
      },
    );
  }
});
